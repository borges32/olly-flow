import { EventEmitter } from 'node:events';
import { Inject, Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { ExecutionCancelledError } from '@olly/engine';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { ExecutionEventSink } from './execution-events.service.js';
import type {
  ExecutionJob,
  ExecutionOutcome,
  WaitResult,
  WebhookResponse,
} from './execution-job.js';
import { ExecutionRunner } from './execution-runner.js';

export type { WaitResult };

/**
 * Despacho de execuções (spec 005, FR-003, plan §2): abstração substituível. Em processo (spec
 * 005) ou pela fila com workers (spec 006); `RoutingDispatcher` escolhe por modo.
 */
export abstract class ExecutionDispatcher {
  /** Status com que a execução nova é gravada: `queued` se ainda vai esperar vaga. */
  abstract initialStatus(mode: ExecutionJob['mode']): 'queued' | 'running';
  abstract dispatch(job: ExecutionJob): Promise<void>;
  /** Espera o fim da execução ou, com `untilResponse`, a resposta do webhook (o que vier antes). */
  abstract waitForResult(
    executionId: string,
    timeoutMs: number,
    untilResponse?: boolean,
  ): Promise<WaitResult>;
  /**
   * Cancela a execução (spec 006, FR-010): na fila, termina na hora; em andamento, sinaliza
   * quem executa. `false` se ela não está mais na fila nem em andamento.
   */
  abstract cancel(executionId: string, reason: ExecutionCancelledError): Promise<boolean>;
}

const RECENT = 200;

/** Grava o cancelamento de uma execução que ainda não começou. */
export async function cancelQueued(
  db: Db,
  executionId: string,
  reason: ExecutionCancelledError,
): Promise<{ workflowId: string; outcome: ExecutionOutcome; finishedAt: Date } | null> {
  const error = { message: reason.message, reason: reason.reason };
  const finishedAt = new Date();
  const row = await db
    .updateTable('executions')
    .set({ status: 'cancelled', finished_at: finishedAt, error: JSON.stringify(error) })
    .where('id', '=', executionId)
    .where('status', '=', 'queued')
    .returning('workflow_id')
    .executeTakeFirst();
  return row
    ? { workflowId: row.workflow_id, outcome: { status: 'cancelled', error }, finishedAt }
    : null;
}

/**
 * Cancela uma execução em espera (spec 008, FR-012): sem worker envolvido, encerra direto no
 * banco, fecha os nós que esperavam e descarta o estado salvo.
 */
export async function cancelWaiting(
  db: Db,
  executionId: string,
  reason: ExecutionCancelledError,
): Promise<{ workflowId: string; outcome: ExecutionOutcome; finishedAt: Date } | null> {
  const error = { message: reason.message, reason: reason.reason };
  const finishedAt = new Date();
  const row = await db
    .updateTable('executions')
    .set({ status: 'cancelled', finished_at: finishedAt, error: JSON.stringify(error) })
    .where('id', '=', executionId)
    .where('status', '=', 'waiting')
    .returning('workflow_id')
    .executeTakeFirst();
  if (!row) return null;
  await db
    .updateTable('node_executions')
    .set({ status: 'cancelled', finished_at: finishedAt, error: JSON.stringify(error) })
    .where('execution_id', '=', executionId)
    .where('status', '=', 'waiting')
    .execute();
  await db.deleteFrom('execution_state').where('execution_id', '=', executionId).execute();
  // Spec 011: pedidos de aprovação pendentes da execução deixam de valer.
  await db
    .updateTable('approval_requests')
    .set({ status: 'cancelled', decided_at: finishedAt })
    .where('execution_id', '=', executionId)
    .where('status', '=', 'pending')
    .execute();
  return { workflowId: row.workflow_id, outcome: { status: 'cancelled', error }, finishedAt };
}

/**
 * Despacho no processo da API com limite de concorrência (`OLLY_MAX_CONCURRENT_EXECUTIONS`).
 * O excedente espera numa fila em memória com status `queued`; os resultados saem por um
 * `EventEmitter`. Resultados recentes ficam guardados para quem pergunta depois do fim. Na
 * spec 006, só para execuções de teste com `OLLY_TEST_RUN_MODE=inprocess`.
 */
@Injectable()
export class InProcessDispatcher extends ExecutionDispatcher implements BeforeApplicationShutdown {
  private readonly logger = new Logger('Dispatcher');
  private readonly emitter = new EventEmitter();
  private readonly queue: ExecutionJob[] = [];
  private readonly running = new Map<
    string,
    { run: Promise<unknown>; controller: AbortController }
  >();
  private readonly outcomes = new Map<string, ExecutionOutcome>();
  private readonly responses = new Map<string, WebhookResponse>();
  private readonly max: number;

  constructor(
    @Inject(ExecutionRunner) private readonly runner: ExecutionRunner,
    @Inject(DB) private readonly db: Db,
    @Inject(ExecutionEventSink) private readonly events: ExecutionEventSink,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    super();
    this.max = config.dispatcher.maxConcurrent;
    this.emitter.setMaxListeners(0);
  }

  private get saturated(): boolean {
    return this.running.size >= this.max;
  }

  initialStatus(): 'queued' | 'running' {
    return this.saturated ? 'queued' : 'running';
  }

  get stats(): { running: number; queued: number } {
    return { running: this.running.size, queued: this.queue.length };
  }

  /** A execução está (ou esteve há pouco) sob este despacho. */
  owns(executionId: string): boolean {
    return (
      this.running.has(executionId) ||
      this.outcomes.has(executionId) ||
      this.queue.some((j) => j.executionId === executionId)
    );
  }

  dispatch(job: ExecutionJob): Promise<void> {
    if (this.saturated) this.queue.push(job);
    else this.start(job, false);
    return Promise.resolve();
  }

  private start(job: ExecutionJob, fromQueue: boolean): void {
    const controller = new AbortController();
    const run = (async () => {
      if (fromQueue) {
        const claimed = await this.db
          .updateTable('executions')
          .set({ status: 'running' })
          .where('id', '=', job.executionId)
          .where('status', '=', 'queued')
          .executeTakeFirst();
        // Cancelada enquanto esperava.
        if (claimed.numUpdatedRows === 0n) return;
      }
      const outcome = await this.runner.execute(job, {
        signal: controller.signal,
        onWebhookResponse: (response) => {
          this.remember(this.responses, job.executionId, response);
          this.emitter.emit(`response:${job.executionId}`, response);
        },
      });
      this.settle(job.executionId, outcome);
    })()
      .catch((e: unknown) => {
        this.logger.error(`Falha ao executar ${job.executionId}: ${String(e)}`);
      })
      .finally(() => {
        this.running.delete(job.executionId);
        const next = this.queue.shift();
        if (next) this.start(next, true);
      });
    this.running.set(job.executionId, { run, controller });
  }

  private settle(executionId: string, outcome: ExecutionOutcome): void {
    this.remember(this.outcomes, executionId, outcome);
    this.emitter.emit(`finished:${executionId}`, outcome);
  }

  private remember<T>(map: Map<string, T>, id: string, value: T): void {
    map.set(id, value);
    if (map.size > RECENT) map.delete(map.keys().next().value ?? '');
  }

  async cancel(executionId: string, reason: ExecutionCancelledError): Promise<boolean> {
    const running = this.running.get(executionId);
    if (running) {
      running.controller.abort(reason);
      return true;
    }
    const index = this.queue.findIndex((j) => j.executionId === executionId);
    if (index < 0) return false;
    const [job] = this.queue.splice(index, 1);
    const cancelled = await cancelQueued(this.db, executionId, reason);
    if (!cancelled || !job) return false;
    this.events.emit(
      'executionFinished',
      {
        executionId,
        status: 'cancelled',
        finishedAt: cancelled.finishedAt.toISOString(),
        error: cancelled.outcome.error ?? null,
      },
      cancelled.workflowId,
    );
    this.settle(executionId, cancelled.outcome);
    return true;
  }

  waitForResult(
    executionId: string,
    timeoutMs: number,
    untilResponse = false,
  ): Promise<WaitResult> {
    const response = this.responses.get(executionId);
    if (untilResponse && response) return Promise.resolve({ kind: 'response', response });
    const outcome = this.outcomes.get(executionId);
    if (outcome) return Promise.resolve({ kind: 'finished', outcome });
    return new Promise((resolve) => {
      const done = (result: WaitResult) => {
        clearTimeout(timer);
        this.emitter.off(`finished:${executionId}`, onFinished);
        this.emitter.off(`response:${executionId}`, onResponse);
        resolve(result);
      };
      const onFinished = (o: ExecutionOutcome) => {
        done({ kind: 'finished', outcome: o });
      };
      const onResponse = (r: WebhookResponse) => {
        done({ kind: 'response', response: r });
      };
      const timer = setTimeout(() => {
        done({ kind: 'timeout' });
      }, timeoutMs);
      this.emitter.on(`finished:${executionId}`, onFinished);
      if (untilResponse) this.emitter.on(`response:${executionId}`, onResponse);
    });
  }

  /** Espera as execuções em andamento antes de fechar o banco. */
  async beforeApplicationShutdown(): Promise<void> {
    this.queue.length = 0;
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000).unref());
    await Promise.race([Promise.allSettled([...this.running.values()].map((r) => r.run)), timeout]);
  }
}
