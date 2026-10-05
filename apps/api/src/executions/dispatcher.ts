import { EventEmitter } from 'node:events';
import { Inject, Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import type { Db } from '@olly/db';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { ExecutionEventsService } from './execution-events.service.js';
import type { ExecutionJob, ExecutionOutcome, WebhookResponse } from './execution-job.js';
import { ExecutionRunner } from './execution-runner.js';

export type WaitResult =
  | { kind: 'response'; response: WebhookResponse }
  | { kind: 'finished'; outcome: ExecutionOutcome }
  | { kind: 'timeout' };

/**
 * Despacho de execuções (spec 005, FR-003, plan §2): abstração substituível. Nesta spec, em
 * processo; na spec 006, uma fila com workers implementa a mesma interface.
 */
export abstract class ExecutionDispatcher {
  /** Sem vaga agora: a execução nova ficará `queued`. */
  abstract get saturated(): boolean;
  abstract dispatch(job: ExecutionJob): void;
  /** Espera o fim da execução ou, com `untilResponse`, a resposta do webhook (o que vier antes). */
  abstract waitForResult(
    executionId: string,
    timeoutMs: number,
    untilResponse?: boolean,
  ): Promise<WaitResult>;
}

const RECENT = 200;

/**
 * Despacho no processo da API com limite de concorrência (`OLLY_MAX_CONCURRENT_EXECUTIONS`).
 * O excedente espera numa fila em memória com status `queued`; os resultados saem por um
 * `EventEmitter`. Resultados recentes ficam guardados para quem pergunta depois do fim.
 */
@Injectable()
export class InProcessDispatcher extends ExecutionDispatcher implements BeforeApplicationShutdown {
  private readonly logger = new Logger('Dispatcher');
  private readonly emitter = new EventEmitter();
  private readonly queue: ExecutionJob[] = [];
  private readonly running = new Set<Promise<unknown>>();
  private readonly outcomes = new Map<string, ExecutionOutcome>();
  private readonly responses = new Map<string, WebhookResponse>();
  private readonly max: number;

  constructor(
    @Inject(ExecutionRunner) private readonly runner: ExecutionRunner,
    @Inject(DB) private readonly db: Db,
    @Inject(ExecutionEventsService) private readonly events: ExecutionEventsService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    super();
    this.max = config.dispatcher.maxConcurrent;
    this.emitter.setMaxListeners(0);
  }

  get saturated(): boolean {
    return this.running.size >= this.max;
  }

  get stats(): { running: number; queued: number } {
    return { running: this.running.size, queued: this.queue.length };
  }

  dispatch(job: ExecutionJob): void {
    if (this.saturated) {
      this.queue.push(job);
      return;
    }
    this.start(job, false);
  }

  private start(job: ExecutionJob, fromQueue: boolean): void {
    const run = (async () => {
      const startedAt = new Date();
      if (fromQueue) {
        await this.db
          .updateTable('executions')
          .set({ status: 'running' })
          .where('id', '=', job.executionId)
          .execute()
          .catch((e: unknown) => {
            this.logger.warn(
              `Não foi possível marcar ${job.executionId} como running: ${String(e)}`,
            );
          });
      }
      this.events.emit(
        'executionStarted',
        {
          executionId: job.executionId,
          workflowId: job.workflow.id,
          startedAt: startedAt.toISOString(),
        },
        job.workflow.id,
      );
      const outcome = await this.runner.execute(job, {
        onWebhookResponse: (response) => {
          this.remember(this.responses, job.executionId, response);
          this.emitter.emit(`response:${job.executionId}`, response);
        },
      });
      this.remember(this.outcomes, job.executionId, outcome);
      this.emitter.emit(`finished:${job.executionId}`, outcome);
    })()
      .catch((e: unknown) => {
        this.logger.error(`Falha ao executar ${job.executionId}: ${String(e)}`);
      })
      .finally(() => {
        this.running.delete(run);
        const next = this.queue.shift();
        if (next) this.start(next, true);
      });
    this.running.add(run);
  }

  private remember<T>(map: Map<string, T>, id: string, value: T): void {
    map.set(id, value);
    if (map.size > RECENT) map.delete(map.keys().next().value ?? '');
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
    await Promise.race([Promise.allSettled([...this.running]), timeout]);
  }
}
