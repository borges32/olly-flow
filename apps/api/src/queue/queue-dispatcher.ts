import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Db } from '@olly/db';
import type { ExecutionCancelledError } from '@olly/engine';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { BINARY_STORAGE } from '../binary/binary.module.js';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { createRedisConnection } from '../core/redis.js';
import { DB, REDIS } from '../core/tokens.js';
import { ExecutionDispatcher, cancelQueued, cancelWaiting } from '../executions/dispatcher.js';
import { ExecutionEventSink } from '../executions/execution-events.service.js';
import type { CancelMessage, ExecutionJob, WaitResult } from '../executions/execution-job.js';
import { ResultPublisher, ResultSubscriber } from '../executions/result-bus.js';
import { context, SpanKind, trace } from '@opentelemetry/api';
import { injectTraceContext } from '@olly/telemetry';
import { CANCEL_CHANNEL, EXECUTIONS_QUEUE, type ExecutionJobData } from './constants.js';
import { savePayload } from './payloads.js';

/**
 * Despacho pela fila BullMQ (spec 006, FR-001, plan §1): grava os dados do disparo em
 * `execution_payloads` e enfileira só o id; um worker executa. Os resultados (resposta do
 * webhook e desfecho) voltam pelo Redis (FR-002).
 */
@Injectable()
export class QueueDispatcher
  extends ExecutionDispatcher
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger('QueueDispatcher');
  private producer?: Redis;
  private subscriber?: Redis;
  private queue?: Queue<ExecutionJobData>;
  private results?: ResultSubscriber;
  private readonly publisher: ResultPublisher;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ExecutionEventSink) private readonly events: ExecutionEventSink,
    @Inject(BINARY_STORAGE) private readonly binaries: S3BinaryStorage | null,
  ) {
    super();
    this.publisher = new ResultPublisher(redis);
  }

  async onModuleInit(): Promise<void> {
    // Produtor sem fila offline: com o Redis fora do ar, o webhook falha na hora (500).
    this.producer = new Redis(this.config.redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectionName: 'olly-queue-producer',
    });
    this.producer.on('error', () => undefined);
    this.queue = new Queue(EXECUTIONS_QUEUE, { connection: this.producer });
    this.queue.on('error', (error) => {
      this.logger.warn(`Fila indisponível: ${error.message}`);
    });
    this.subscriber = createRedisConnection(this.config.redisUrl, 'results');
    this.results = new ResultSubscriber(this.subscriber, this.redis);
    await Promise.race([
      this.queue.waitUntilReady().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 2000).unref()),
    ]);
  }

  initialStatus(): 'queued' {
    return 'queued';
  }

  async dispatch(job: ExecutionJob): Promise<void> {
    if (!this.queue) throw new Error('Fila de execuções não inicializada');
    const { triggerItems, startNodeId, pinData, destinationNodeId, reuse } = job;
    await savePayload(this.db, this.binaries, job.executionId, {
      ...(triggerItems && { triggerItems }),
      ...(startNodeId && { startNodeId }),
      ...(pinData && { pinData }),
      ...(destinationNodeId && { destinationNodeId }),
      ...(reuse && { reuse }),
    });
    // Spec 012, FR-001: o trace de quem disparou (ex.: a requisição do webhook) continua no worker.
    const span = trace.getTracer('olly-flow').startSpan('execution.enqueue', {
      kind: SpanKind.PRODUCER,
      attributes: {
        'olly.execution.id': job.executionId,
        'olly.workflow.id': job.workflow.id,
        'olly.project.id': job.workflow.projectId,
      },
    });
    const traceCarrier = injectTraceContext(trace.setSpan(context.active(), span));
    span.end();
    await this.queue.add(
      'execution',
      {
        executionId: job.executionId,
        ...(Object.keys(traceCarrier).length > 0 && { trace: traceCarrier }),
      },
      {
        jobId: job.executionId,
        // FR-005: nunca reexecutar automaticamente (efeitos colaterais duplicados).
        attempts: 1,
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600 },
      },
    );
  }

  waitForResult(
    executionId: string,
    timeoutMs: number,
    untilResponse = false,
  ): Promise<WaitResult> {
    if (!this.results) return Promise.resolve({ kind: 'timeout' });
    return this.results.wait(executionId, timeoutMs, untilResponse);
  }

  async cancel(executionId: string, reason: ExecutionCancelledError): Promise<boolean> {
    const queued =
      (await cancelQueued(this.db, executionId, reason)) ??
      (await cancelWaiting(this.db, executionId, reason));
    if (queued) {
      this.events.emit(
        'executionFinished',
        {
          executionId,
          status: 'cancelled',
          finishedAt: queued.finishedAt.toISOString(),
          error: queued.outcome.error ?? null,
        },
        queued.workflowId,
      );
      await this.publisher.finished(executionId, queued.outcome).catch((e: unknown) => {
        this.logger.warn(`Resultado do cancelamento de ${executionId} não publicado: ${String(e)}`);
      });
      // O worker também ignora o job (a execução não está mais `queued`).
      await this.queue?.remove(executionId).catch(() => undefined);
      return true;
    }
    const row = await this.db
      .selectFrom('executions')
      .select('status')
      .where('id', '=', executionId)
      .executeTakeFirst();
    if (row?.status !== 'running') return false;
    const message: CancelMessage = { executionId, reason: reason.reason, message: reason.message };
    await this.redis.publish(CANCEL_CHANNEL, JSON.stringify(message));
    return true;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
    this.producer?.disconnect();
    this.subscriber?.disconnect();
  }
}
