import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Db } from '@olly/db';
import {
  ExecutionCancelledError,
  RecordedRun,
  buildExpressionData,
  collectInputs,
  validateWorkflow,
  type SourceRef,
} from '@olly/engine';
import { exposedEnv, type ExpressionEvaluator } from '@olly/expressions';
import type { NodeRegistry } from '@olly/nodes';
import type {
  ExecutionDetail,
  ExecutionList,
  ExecutionStatus,
  ExpressionPreviewResponse,
  Item,
  NodeExecutionStatus,
  NodeOutput,
  QueueStats,
  TestRunResponse,
  WorkflowDefinition,
} from '@olly/shared-types';
import { sql } from 'kysely';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  UnprocessableError,
} from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { EXPRESSION_EVALUATOR } from '../expressions/expressions.module.js';
import { NODE_REGISTRY } from '../node-types/node-types.module.js';
import { hasProjectPermission } from '../rbac/ability.factory.js';
import { ExecutionDispatcher } from './dispatcher.js';
import type { ExecutionJob } from './execution-job.js';
import type { ListExecutionsQuery, PreviewBody, TestRunBody } from './executions.schemas.js';

const PARTITION_REFRESH_MS = 12 * 60 * 60 * 1000;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Execução a iniciar: o que `launch` grava e despacha (spec 005, FR-003). */
export interface LaunchRequest {
  workflow: { id: string; name: string; project_id: string; version: number; active?: boolean };
  /** Versão gravada na execução (publicada, em produção; a salva, nos testes). */
  version: number;
  definition: WorkflowDefinition;
  mode: 'test' | 'production';
  triggerType: string;
  triggeredBy: string | null;
  job?: Partial<
    Pick<ExecutionJob, 'triggerItems' | 'startNodeId' | 'pinData' | 'destinationNodeId' | 'reuse'>
  >;
}

/** Execuções: início (teste e produção), log (FR-013/FR-014) e preview de expressões. */
@Injectable()
export class ExecutionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExecutionsService.name);
  private partitionTimer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(NODE_REGISTRY) private readonly registry: NodeRegistry,
    @Inject(EXPRESSION_EVALUATOR) private readonly evaluator: ExpressionEvaluator,
    @Inject(ExecutionDispatcher) private readonly dispatcher: ExecutionDispatcher,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    void this.ensurePartitions();
    this.partitionTimer = setInterval(() => void this.ensurePartitions(), PARTITION_REFRESH_MS);
    this.partitionTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.partitionTimer);
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

  validate(definition: WorkflowDefinition): void {
    const { errors } = validateWorkflow(definition, this.registry);
    if (errors.length > 0) {
      throw new UnprocessableError('O workflow tem erros de estrutura', {
        issues: errors.map((e) => ({ code: e.code, message: e.message, nodeIds: e.nodeIds })),
      });
    }
  }

  /**
   * Grava a execução (com a definição executada) e a despacha (FR-003). Na fila (spec 006), ou
   * sem vaga no despacho em processo, ela fica `queued` até começar.
   */
  async launch(req: LaunchRequest): Promise<{ executionId: string }> {
    const execution = await this.db
      .insertInto('executions')
      .values({
        workflow_id: req.workflow.id,
        project_id: req.workflow.project_id,
        workflow_version: req.version,
        mode: req.mode,
        trigger_type: req.triggerType,
        triggered_by: req.triggeredBy,
        status: this.dispatcher.initialStatus(req.mode),
        definition: JSON.stringify(req.definition),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const job: ExecutionJob = {
      executionId: execution.id,
      workflow: {
        id: req.workflow.id,
        name: req.workflow.name,
        projectId: req.workflow.project_id,
        active: req.workflow.active ?? false,
      },
      definition: req.definition,
      mode: req.mode,
      ...req.job,
    };
    try {
      await this.dispatcher.dispatch(job);
    } catch (error) {
      // Ex.: Redis fora do ar. A execução não fica "na fila" para sempre.
      this.logger.error(`Não foi possível despachar a execução ${execution.id}: ${String(error)}`);
      await this.db
        .updateTable('executions')
        .set({
          status: 'error',
          finished_at: new Date(),
          error: JSON.stringify({ message: 'Não foi possível enfileirar a execução' }),
        })
        .where('id', '=', execution.id)
        .execute();
      throw error;
    }
    return { executionId: execution.id };
  }

  /**
   * Spec 006, FR-010: cancela uma execução na fila (termina na hora) ou em andamento (o worker
   * interrompe as operações em curso). Auditado.
   */
  async cancel(ctx: AuditContext, user: AuthenticatedUser, executionId: string): Promise<void> {
    const execution = await this.db
      .selectFrom('executions')
      .select(['status', 'workflow_id'])
      .where('id', '=', executionId)
      .executeTakeFirst();
    if (!execution) throw new NotFoundError('Execução não encontrada');
    const who = user.name ?? user.email;
    const reason = new ExecutionCancelledError('cancelled', `Execução cancelada por ${who}`);
    const signalled =
      ['queued', 'running'].includes(execution.status) &&
      (await this.dispatcher.cancel(executionId, reason));
    if (!signalled) throw new ConflictError('A execução já terminou');
    await this.audit.record(this.db, ctx, {
      action: 'execution.cancel',
      entityType: 'execution',
      entityId: executionId,
      details: { workflowId: execution.workflow_id, status: execution.status },
    });
  }

  /** Spec 006, FR-012: ocupação da fila do projeto, para o indicador da UI. */
  async queueStats(projectId: string): Promise<QueueStats> {
    const [counts, project] = await Promise.all([
      this.db
        .selectFrom('executions')
        .select(['status', (eb) => eb.fn.countAll<string>().as('n')])
        .where('project_id', '=', projectId)
        .where('status', 'in', ['queued', 'running'])
        .groupBy('status')
        .execute(),
      this.db
        .selectFrom('projects')
        .select('max_concurrent_executions')
        .where('id', '=', projectId)
        .executeTakeFirst(),
    ]);
    if (!project) throw new NotFoundError('Projeto não encontrado');
    const count = (status: string) => Number(counts.find((c) => c.status === status)?.n ?? 0);
    return {
      running: count('running'),
      queued: count('queued'),
      limit: project.max_concurrent_executions ?? this.config.queue.projectMaxConcurrent,
      customLimit: project.max_concurrent_executions !== null,
    };
  }

  /** FR-011 (spec 003): execução de teste a partir do editor, auditada (spec 005, FR-016). */
  async startTestRun(
    ctx: AuditContext,
    user: AuthenticatedUser,
    workflowId: string,
    body: TestRunBody,
    trigger: { type: string; triggerItems?: Item[]; startNodeId?: string } = { type: 'manual' },
  ): Promise<TestRunResponse> {
    this.validate(body.definition);
    const destination = body.destinationNodeId;
    if (destination && !body.definition.nodes.some((n) => n.id === destination)) {
      throw new UnprocessableError('Nó de destino inexistente no workflow');
    }
    const workflow = await this.db
      .selectFrom('workflows')
      .select(['id', 'name', 'version', 'project_id', 'active'])
      .where('id', '=', workflowId)
      .executeTakeFirstOrThrow();
    await this.assertCredentialUse(user, workflow, body);
    const pinData = body.pinData ?? body.definition.pinData;
    const { executionId } = await this.launch({
      workflow,
      version: workflow.version,
      definition: body.definition,
      mode: 'test',
      triggerType: trigger.type,
      triggeredBy: user.id,
      job: {
        ...(pinData && { pinData }),
        ...(destination && { destinationNodeId: destination }),
        ...(body.reuse && { reuse: body.reuse }),
        ...(trigger.triggerItems && { triggerItems: trigger.triggerItems }),
        ...(trigger.startNodeId && { startNodeId: trigger.startNodeId }),
      },
    });
    await this.audit.record(this.db, ctx, {
      action: 'execution.manual',
      entityType: 'execution',
      entityId: executionId,
      details: { workflowId, trigger: trigger.type },
    });
    return { executionId };
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

  /**
   * FR-013: execuções com filtros, só dos projetos em que o usuário tem `execution:read`,
   * paginadas por cursor (`started_at`, `id`), mais recentes primeiro.
   */
  async list(user: AuthenticatedUser, query: ListExecutionsQuery): Promise<ExecutionList> {
    const allowed = user.isAdmin
      ? null
      : Object.entries(user.permissions.projects)
          .filter(([, perms]) => perms.includes('execution:read'))
          .map(([id]) => id);
    if (allowed?.length === 0) return { items: [], nextCursor: null };
    if (query.projectId && allowed && !allowed.includes(query.projectId)) {
      return { items: [], nextCursor: null };
    }
    let cursor: { startedAt: Date; id: string } | undefined;
    if (query.cursor) {
      const [ms, id] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
      if (!ms || !id) throw new UnprocessableError('Cursor inválido');
      cursor = { startedAt: new Date(Number(ms)), id };
    }
    const rows = await this.db
      .selectFrom('executions as e')
      .innerJoin('workflows as w', 'w.id', 'e.workflow_id')
      .select([
        'e.id',
        'e.workflow_id',
        'w.name as workflow_name',
        'e.project_id',
        'e.workflow_version',
        'e.mode',
        'e.trigger_type',
        'e.triggered_by',
        'e.status',
        'e.started_at',
        'e.finished_at',
      ])
      .$if(allowed !== null, (qb) => qb.where('e.project_id', 'in', allowed ?? []))
      .$if(query.projectId !== undefined, (qb) =>
        qb.where('e.project_id', '=', query.projectId ?? ''),
      )
      .$if(query.workflowId !== undefined, (qb) =>
        qb.where('e.workflow_id', '=', query.workflowId ?? ''),
      )
      .$if(query.status !== undefined, (qb) => qb.where('e.status', '=', query.status ?? ''))
      .$if(query.mode !== undefined, (qb) => qb.where('e.mode', '=', query.mode ?? 'test'))
      .$if(query.trigger !== undefined, (qb) =>
        qb.where('e.trigger_type', '=', query.trigger ?? ''),
      )
      .$if(query.userId !== undefined, (qb) => qb.where('e.triggered_by', '=', query.userId ?? ''))
      .$if(query.from !== undefined, (qb) =>
        qb.where('e.started_at', '>=', new Date(query.from ?? 0)),
      )
      .$if(query.to !== undefined, (qb) => qb.where('e.started_at', '<=', new Date(query.to ?? 0)))
      .$if(cursor !== undefined, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('e.started_at', '<', cursor?.startedAt ?? new Date()),
            eb.and([
              eb('e.started_at', '=', cursor?.startedAt ?? new Date()),
              eb('e.id', '<', cursor?.id ?? ''),
            ]),
          ]),
        ),
      )
      .orderBy('e.started_at', 'desc')
      .orderBy('e.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        workflowId: r.workflow_id,
        workflowName: r.workflow_name,
        projectId: r.project_id,
        workflowVersion: r.workflow_version,
        mode: r.mode,
        triggerType: r.trigger_type,
        triggeredBy: r.triggered_by,
        status: r.status as ExecutionStatus,
        startedAt: r.started_at.toISOString(),
        finishedAt: iso(r.finished_at),
        durationMs: r.finished_at ? r.finished_at.getTime() - r.started_at.getTime() : null,
      })),
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(`${last.started_at.getTime()}|${last.id}`).toString('base64url')
          : null,
    };
  }

  /** FR-014 (specs 003 e 005): execução e nós; sem `execution:readData`, sem os dados. */
  async get(user: AuthenticatedUser, executionId: string): Promise<ExecutionDetail> {
    const execution = await this.db
      .selectFrom('executions')
      .selectAll()
      .where('id', '=', executionId)
      .executeTakeFirst();
    if (!execution) throw new NotFoundError('Execução não encontrada');
    const canReadData = hasProjectPermission(user, 'execution:readData', execution.project_id);
    const nodes = await this.db
      .selectFrom('node_executions')
      .selectAll()
      .where('execution_id', '=', executionId)
      .orderBy('started_at')
      .orderBy('run_index')
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
      dataRedacted: !canReadData,
      definition: (execution.definition as WorkflowDefinition | null) ?? null,
      nodes: nodes.map((n) => ({
        nodeId: n.node_id,
        nodeName: n.node_name,
        runIndex: n.run_index,
        status: n.status as NodeExecutionStatus,
        startedAt: n.started_at.toISOString(),
        finishedAt: iso(n.finished_at),
        itemsIn: n.items_in,
        itemsOut: n.items_out,
        pinned: n.pinned,
        reused: n.reused,
        dataTruncated: n.data_truncated,
        input: canReadData ? (n.input_data as Record<string, Item[]> | null) : null,
        output: canReadData ? (n.output_data as NodeOutput | null) : null,
        console: canReadData ? (n.console as string[] | null) : null,
        error: n.error as { name: string; message: string } | null,
      })),
    };
  }

  /**
   * FR-018: avalia uma expressão sobre os dados da execução de teste indicada, para o nó e o
   * item escolhidos, no mesmo sandbox das execuções.
   */
  async preview(
    user: AuthenticatedUser,
    workflowId: string,
    body: PreviewBody,
  ): Promise<ExpressionPreviewResponse> {
    const node = body.definition.nodes.find((n) => n.id === body.nodeId);
    if (!node) throw new UnprocessableError('Nó inexistente no workflow');

    let view = new RecordedRun([]);
    // Spec 005, FR-014: sem `execution:readData`, a execução indicada não serve de contexto.
    const project = await this.db
      .selectFrom('workflows')
      .select('project_id')
      .where('id', '=', workflowId)
      .executeTakeFirstOrThrow();
    if (body.executionId && hasProjectPermission(user, 'execution:readData', project.project_id)) {
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
        // Em laços (spec 007), vale a última iteração de cada nó.
        .orderBy('run_index')
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
