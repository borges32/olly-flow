import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Db } from '@olly/db';
import {
  RecordedRun,
  buildExpressionData,
  collectInputs,
  runWorkflow,
  validateWorkflow,
  type ReusedNodeRun,
  type SourceRef,
} from '@olly/engine';
import { exposedEnv, type ExpressionEvaluator } from '@olly/expressions';
import type { NodeRegistry } from '@olly/nodes';
import type {
  ExecutionDetail,
  ExecutionStatus,
  ExpressionPreviewResponse,
  Item,
  NodeExecutionStatus,
  NodeOutput,
  TestRunResponse,
  WorkflowDefinition,
} from '@olly/shared-types';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { BINARY_STORAGE } from '../binary/binary.module.js';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';
import { NotFoundError, PermissionDeniedError, UnprocessableError } from '../common/errors.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { hasProjectPermission } from '../rbac/ability.factory.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { EXPRESSION_EVALUATOR } from '../expressions/expressions.module.js';
import { NODE_REGISTRY } from '../node-types/node-types.module.js';
import { ExecutionEventsService } from './execution-events.service.js';
import { ExecutionRecorder } from './execution-recorder.js';
import type { PreviewBody, TestRunBody } from './executions.schemas.js';

const PARTITION_REFRESH_MS = 12 * 60 * 60 * 1000;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Execução de teste no processo da API (plan §7), log (plan §6) e preview de expressões. */
@Injectable()
export class ExecutionsService implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly logger = new Logger(ExecutionsService.name);
  private readonly running = new Set<Promise<void>>();
  private partitionTimer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(NODE_REGISTRY) private readonly registry: NodeRegistry,
    @Inject(EXPRESSION_EVALUATOR) private readonly evaluator: ExpressionEvaluator,
    @Inject(ExecutionEventsService) private readonly events: ExecutionEventsService,
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
    @Inject(BINARY_STORAGE) private readonly binaries: S3BinaryStorage | null,
  ) {}

  onModuleInit(): void {
    void this.ensurePartitions();
    this.partitionTimer = setInterval(() => void this.ensurePartitions(), PARTITION_REFRESH_MS);
    this.partitionTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.partitionTimer);
  }

  /** Espera as execuções em andamento antes de fechar o banco. */
  async beforeApplicationShutdown(): Promise<void> {
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000).unref());
    await Promise.race([Promise.allSettled([...this.running]), timeout]);
  }

  private async ensurePartitions(): Promise<void> {
    try {
      await sql`SELECT olly_ensure_partitions(2)`.execute(this.db);
    } catch (error) {
      this.logger.warn(
        `Não foi possível garantir as partições do log de execuções: ${String(error)}`,
      );
    }
  }

  private validate(definition: WorkflowDefinition): void {
    const { errors } = validateWorkflow(definition, this.registry);
    if (errors.length > 0) {
      throw new UnprocessableError('O workflow tem erros de estrutura', {
        issues: errors.map((e) => ({ code: e.code, message: e.message, nodeIds: e.nodeIds })),
      });
    }
  }

  /** FR-011: inicia a execução de teste e devolve o id; o resto acontece em segundo plano. */
  async startTestRun(
    user: AuthenticatedUser,
    workflowId: string,
    body: TestRunBody,
  ): Promise<TestRunResponse> {
    const userId = user.id;
    this.validate(body.definition);
    const destination = body.destinationNodeId;
    if (destination && !body.definition.nodes.some((n) => n.id === destination)) {
      throw new UnprocessableError('Nó de destino inexistente no workflow');
    }
    const workflow = await this.db
      .selectFrom('workflows')
      .select(['id', 'name', 'version', 'project_id'])
      .where('id', '=', workflowId)
      .executeTakeFirstOrThrow();
    await this.assertCredentialUse(user, workflow, body);
    const execution = await this.db
      .insertInto('executions')
      .values({
        workflow_id: workflow.id,
        project_id: workflow.project_id,
        workflow_version: workflow.version,
        mode: 'test',
        trigger_type: 'manual',
        triggered_by: userId,
        status: 'running',
      })
      .returning(['id', 'started_at'])
      .executeTakeFirstOrThrow();

    this.events.emit(
      'executionStarted',
      { executionId: execution.id, workflowId, startedAt: execution.started_at.toISOString() },
      workflowId,
    );
    const run = this.run(execution.id, workflow, body).finally(() => this.running.delete(run));
    this.running.add(run);
    return { executionId: execution.id };
  }

  /**
   * Spec 004, FR-007 (plan §10): sem `credential:use`, um workflow que usa credenciais só roda
   * como está salvo; quem não pode usar a credencial não muda para onde os segredos vão.
   */
  private async assertCredentialUse(
    user: AuthenticatedUser,
    workflow: { id: string; version: number; project_id: string },
    body: TestRunBody,
  ): Promise<void> {
    if (!body.definition.nodes.some((n) => n.credentialId)) return;
    if (hasProjectPermission(user, 'credential:use', workflow.project_id)) return;
    const saved = await this.db
      .selectFrom('workflow_versions')
      .select('definition')
      .where('workflow_id', '=', workflow.id)
      .where('version', '=', workflow.version)
      .executeTakeFirst();
    // Chaves ordenadas: o JSONB do Postgres não preserva a ordem das chaves.
    const stable = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(stable)
        : typeof value === 'object' && value !== null
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
            )
          : value;
    const canonical = (def: WorkflowDefinition, pinData: unknown) =>
      JSON.stringify(
        stable({
          nodes: [...def.nodes]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((n) => ({ ...n, position: null })),
          edges: [...def.edges].sort((a, b) => a.id.localeCompare(b.id)),
          pinData: pinData ?? {},
        }),
      );
    const savedDef = saved?.definition as WorkflowDefinition | undefined;
    if (
      !savedDef ||
      canonical(body.definition, body.pinData ?? body.definition.pinData) !==
        canonical(savedDef, savedDef.pinData)
    ) {
      throw new PermissionDeniedError(
        'Sem a permissão credential:use, só é possível executar a versão salva de um workflow que usa credenciais',
      );
    }
  }

  /** Logger dos nós (ex.: aviso de `maxRows`), com o id da execução. */
  private nodeLogger(executionId: string) {
    const format = (message: string, data?: Record<string, unknown>) =>
      `${message} ${JSON.stringify({ executionId, ...data })}`;
    return {
      debug: (m: string, d?: Record<string, unknown>) => {
        this.logger.debug(format(m, d));
      },
      info: (m: string, d?: Record<string, unknown>) => {
        this.logger.log(format(m, d));
      },
      warn: (m: string, d?: Record<string, unknown>) => {
        this.logger.warn(format(m, d));
      },
      error: (m: string, d?: Record<string, unknown>) => {
        this.logger.error(format(m, d));
      },
    };
  }

  private async run(
    executionId: string,
    workflow: { id: string; name: string; project_id: string },
    body: TestRunBody,
  ): Promise<void> {
    const recorder = new ExecutionRecorder(
      this.db,
      this.events,
      executionId,
      workflow.id,
      this.config.execution.nodeDataMaxBytes,
      this.logger,
    );
    try {
      const runData = body.reuse ? await this.loadReusable(workflow.id, body.reuse) : undefined;
      await runWorkflow(body.definition, this.registry, {
        executionId,
        mode: 'test',
        workflowId: workflow.id,
        workflowName: workflow.name,
        evaluator: this.evaluator,
        env: exposedEnv(process.env),
        timezone: this.config.execution.timezone,
        pinData: body.pinData ?? body.definition.pinData,
        ...(body.destinationNodeId && { destinationNodeId: body.destinationNodeId }),
        ...(runData && { runData }),
        credentials: (node) =>
          this.credentials.resolveForExecution(workflow.project_id, node.credentialId),
        ...(this.binaries && { binary: this.binaries.forExecution(executionId) }),
        logger: this.nodeLogger(executionId),
        callbacks: recorder.callbacks(),
      });
    } catch (error) {
      // Erros antes de qualquer nó (ex.: workflow sem gatilho).
      const message = error instanceof Error ? error.message : String(error);
      await recorder.finish('error', { message });
    }
  }

  /**
   * FR-020: dados gravados dos nós a reaproveitar. Só execuções deste workflow e nós com
   * sucesso e dados completos; o que não for encontrado simplesmente executa de novo.
   */
  private async loadReusable(
    workflowId: string,
    reuse: Record<string, string>,
  ): Promise<Record<string, ReusedNodeRun>> {
    const pairs = Object.entries(reuse);
    if (pairs.length === 0) return {};
    const rows = await this.db
      .selectFrom('node_executions as ne')
      .innerJoin('executions as e', 'e.id', 'ne.execution_id')
      .select(['ne.node_id', 'ne.input_data', 'ne.input_sources', 'ne.output_data'])
      .where('e.workflow_id', '=', workflowId)
      .where('ne.status', '=', 'success')
      .where('ne.data_truncated', '=', false)
      .where((eb) =>
        eb.or(
          pairs.map(([nodeId, executionId]) =>
            eb.and([eb('ne.node_id', '=', nodeId), eb('ne.execution_id', '=', executionId)]),
          ),
        ),
      )
      .execute();
    return Object.fromEntries(
      rows.map((r) => [
        r.node_id,
        {
          inputs: (r.input_data ?? {}) as Record<string, Item[]>,
          inputSources: (r.input_sources ?? {}) as Record<string, SourceRef[]>,
          output: (r.output_data ?? {}) as NodeOutput,
        },
      ]),
    );
  }

  /** FR-014: execução e nós, com os dados gravados. */
  async get(executionId: string): Promise<ExecutionDetail> {
    const execution = await this.db
      .selectFrom('executions')
      .selectAll()
      .where('id', '=', executionId)
      .executeTakeFirst();
    if (!execution) throw new NotFoundError('Execução não encontrada');
    const nodes = await this.db
      .selectFrom('node_executions')
      .selectAll()
      .where('execution_id', '=', executionId)
      .orderBy('started_at')
      .execute();
    return {
      id: execution.id,
      workflowId: execution.workflow_id,
      projectId: execution.project_id,
      workflowVersion: execution.workflow_version,
      mode: execution.mode,
      triggerType: execution.trigger_type,
      triggeredBy: execution.triggered_by,
      status: execution.status as ExecutionStatus,
      startedAt: execution.started_at.toISOString(),
      finishedAt: iso(execution.finished_at),
      error: execution.error as ExecutionDetail['error'],
      nodes: nodes.map((n) => ({
        nodeId: n.node_id,
        nodeName: n.node_name,
        status: n.status as NodeExecutionStatus,
        startedAt: n.started_at.toISOString(),
        finishedAt: iso(n.finished_at),
        itemsIn: n.items_in,
        itemsOut: n.items_out,
        pinned: n.pinned,
        reused: n.reused,
        dataTruncated: n.data_truncated,
        input: n.input_data as Record<string, Item[]> | null,
        output: n.output_data as NodeOutput | null,
        error: n.error as { name: string; message: string } | null,
      })),
    };
  }

  /**
   * FR-018: avalia uma expressão sobre os dados da execução de teste indicada, para o nó e o
   * item escolhidos, no mesmo sandbox das execuções.
   */
  async preview(workflowId: string, body: PreviewBody): Promise<ExpressionPreviewResponse> {
    const node = body.definition.nodes.find((n) => n.id === body.nodeId);
    if (!node) throw new UnprocessableError('Nó inexistente no workflow');

    let view = new RecordedRun([]);
    if (body.executionId) {
      const execution = await this.db
        .selectFrom('executions')
        .select('workflow_id')
        .where('id', '=', body.executionId)
        .executeTakeFirst();
      if (execution?.workflow_id !== workflowId) throw new NotFoundError('Execução não encontrada');
      const rows = await this.db
        .selectFrom('node_executions')
        .select(['node_id', 'status', 'input_data', 'input_sources', 'output_data'])
        .where('execution_id', '=', body.executionId)
        .execute();
      view = new RecordedRun(
        rows.map((r) => ({
          nodeId: r.node_id,
          status: r.status,
          inputs: r.input_data as Record<string, Item[]> | null,
          inputSources: r.input_sources as Record<string, SourceRef[]> | null,
          output: r.output_data as NodeOutput | null,
        })),
      );
    }
    // Nó que não rodou nessa execução: usa o que os pais produziram.
    if (!view.inputsOf(node.id)) {
      const { inputs, sources } = collectInputs(body.definition, view, node.id);
      view.setInputs(node.id, inputs, sources);
    }
    const input = view.inputsOf(node.id)?.main ?? [];
    const itemIndex = Math.min(body.itemIndex ?? 0, Math.max(0, input.length - 1));
    const previewId = `preview:${randomUUID()}`;
    const workflow = await this.db
      .selectFrom('workflows')
      .select('name')
      .where('id', '=', workflowId)
      .executeTakeFirstOrThrow();
    const data = buildExpressionData(
      body.definition,
      this.registry,
      view,
      node,
      input,
      [body.expression],
      {
        executionId: body.executionId ?? previewId,
        mode: 'test',
        workflow: { id: workflowId, name: workflow.name, active: false },
        vars: {},
        env: exposedEnv(process.env),
        timezone: this.config.execution.timezone,
      },
    );
    try {
      const [result] = await this.evaluator.evaluateBatch({
        executionId: previewId,
        data,
        requests: [{ id: 'preview', template: body.expression, itemIndex }],
      });
      if (!result) return { ok: false, error: { kind: 'runtime', message: 'Sem resultado' } };
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
    } finally {
      await this.evaluator.disposeExecution(previewId).catch(() => undefined);
    }
  }
}
