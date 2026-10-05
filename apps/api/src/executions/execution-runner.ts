import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Db } from '@olly/db';
import {
  ExecutionCancelledError,
  runWorkflow,
  type ReusedNodeRun,
  type SourceRef,
} from '@olly/engine';
import { exposedEnv, type CodeRunner, type ExpressionEvaluator } from '@olly/expressions';
import type { NodeLogger, NodeRegistry } from '@olly/nodes';
import type { Item, NodeOutput } from '@olly/shared-types';
import { BINARY_STORAGE } from '../binary/binary.module.js';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { CODE_RUNNER, EXPRESSION_EVALUATOR } from '../expressions/expressions.module.js';
import { NODE_REGISTRY } from '../node-types/node-types.module.js';
import { ExecutionEventSink } from './execution-events.service.js';
import type { ExecutionJob, ExecutionOutcome, WebhookResponse } from './execution-job.js';
import { ExecutionRecorder } from './execution-recorder.js';

export interface ExecutionHooks {
  onWebhookResponse?: (response: WebhookResponse) => void;
  /** Cancelamento externo (spec 006, FR-010): a razão deve ser um `ExecutionCancelledError`. */
  signal?: AbortSignal;
}

/**
 * Executa um `ExecutionJob` com o motor: log, eventos, credenciais, binários e código. O mesmo
 * executor serve ao despacho em processo e ao worker (spec 006): aplica o timeout global
 * (FR-011), o cancelamento (FR-010) e mantém o batimento da execução (FR-005).
 */
@Injectable()
export class ExecutionRunner {
  private readonly logger = new Logger('Execution');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(NODE_REGISTRY) private readonly registry: NodeRegistry,
    @Inject(EXPRESSION_EVALUATOR) private readonly evaluator: ExpressionEvaluator,
    @Inject(CODE_RUNNER) private readonly codeRunner: CodeRunner,
    @Inject(ExecutionEventSink) private readonly events: ExecutionEventSink,
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
    @Inject(BINARY_STORAGE) private readonly binaries: S3BinaryStorage | null,
  ) {}

  async execute(job: ExecutionJob, hooks: ExecutionHooks = {}): Promise<ExecutionOutcome> {
    const { executionId, workflow } = job;
    const recorder = new ExecutionRecorder(
      this.db,
      this.events,
      executionId,
      workflow.id,
      this.config.execution.nodeDataMaxBytes,
      this.logger,
    );
    const callbacks = recorder.callbacks();
    const controller = new AbortController();
    const timeoutMs = job.definition.settings.timeoutSec
      ? job.definition.settings.timeoutSec * 1000
      : this.config.execution.workflowTimeoutMs;
    const timeout = setTimeout(() => {
      controller.abort(
        new ExecutionCancelledError(
          'timeout',
          `Tempo limite da execução excedido (${formatSeconds(timeoutMs)})`,
        ),
      );
    }, timeoutMs);
    const onCancel = () => {
      controller.abort(hooks.signal?.reason);
    };
    if (hooks.signal?.aborted) onCancel();
    hooks.signal?.addEventListener('abort', onCancel);
    const beat = () =>
      this.db
        .updateTable('executions')
        .set({ heartbeat_at: new Date() })
        .where('id', '=', executionId)
        .where('status', '=', 'running')
        .execute()
        .catch((e: unknown) => {
          this.logger.warn(`Batimento da execução ${executionId} falhou: ${String(e)}`);
        });
    await beat();
    const heartbeat = setInterval(() => void beat(), this.config.queue.heartbeatMs);
    this.events.emit(
      'executionStarted',
      { executionId, workflowId: workflow.id, startedAt: new Date().toISOString() },
      workflow.id,
    );
    let status: ExecutionOutcome['status'] = 'error';
    try {
      const runData = job.reuse ? await this.loadReusable(workflow.id, job.reuse) : undefined;
      const result = await runWorkflow(job.definition, this.registry, {
        executionId,
        mode: job.mode,
        workflowId: workflow.id,
        workflowName: workflow.name,
        evaluator: this.evaluator,
        codeRunner: this.codeRunner,
        env: exposedEnv(process.env),
        timezone: this.config.execution.timezone,
        ...(job.pinData && { pinData: job.pinData }),
        ...(job.triggerItems && { triggerItems: job.triggerItems }),
        ...(job.startNodeId && { startNodeId: job.startNodeId }),
        ...(job.destinationNodeId && { destinationNodeId: job.destinationNodeId }),
        ...(runData && { runData }),
        credentials: (node) =>
          this.credentials.resolveForExecution(workflow.projectId, node.credentialId),
        ...(this.binaries && { binary: this.binaries.forExecution(executionId) }),
        ...(hooks.onWebhookResponse && { onWebhookResponse: hooks.onWebhookResponse }),
        signal: controller.signal,
        maxLoopIterations: this.config.execution.maxLoopIterations,
        logger: this.nodeLogger(executionId),
        callbacks,
      });
      // Modo de resposta `lastNode`: o último nó com dados na ordem topológica (determinístico).
      const lastOutput = [...result.order]
        .reverse()
        .filter((id) => result.nodes[id]?.status === 'success')
        .map((id) => firstItems(result.nodes[id]?.output))
        .find((items) => items !== undefined);
      status =
        result.status === 'cancelled' && result.error?.reason === 'worker_lost'
          ? 'error'
          : result.status;
      return {
        status,
        ...(result.error && { error: result.error }),
        ...(lastOutput && { lastOutput }),
      };
    } catch (error) {
      // Erros antes de qualquer nó (ex.: workflow sem gatilho).
      const message = error instanceof Error ? error.message : String(error);
      await recorder.finish('error', { message });
      return { status: 'error', error: { message } };
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      hooks.signal?.removeEventListener('abort', onCancel);
      this.logger.debug(`Execução ${executionId} terminou: ${status}`);
    }
  }

  /** Logger dos nós (ex.: aviso de `maxRows`), com o id da execução. */
  private nodeLogger(executionId: string): NodeLogger {
    const format = (message: string, data?: Record<string, unknown>) =>
      `${message} ${JSON.stringify({ executionId, ...data })}`;
    return {
      debug: (m, d) => {
        this.logger.debug(format(m, d));
      },
      info: (m, d) => {
        this.logger.log(format(m, d));
      },
      warn: (m, d) => {
        this.logger.warn(format(m, d));
      },
      error: (m, d) => {
        this.logger.error(format(m, d));
      },
    };
  }

  /**
   * Spec 003, FR-020: dados gravados dos nós a reaproveitar. Só execuções deste workflow e nós
   * com sucesso e dados completos; o que não for encontrado simplesmente executa de novo.
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
      // Nó em laço (spec 007) tem várias execuções; nunca é reaproveitado, mas fica a última.
      .orderBy('ne.run_index')
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
}

function formatSeconds(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${(ms / 1000).toFixed(1)} s`;
}

/** Itens da primeira porta com dados. */
function firstItems(output: NodeOutput | undefined): Item[] | undefined {
  return output ? Object.values(output).find((items) => items.length > 0) : undefined;
}
