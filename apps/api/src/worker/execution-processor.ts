import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Db } from '@olly/db';
import { ExecutionCancelledError } from '@olly/engine';
import type { WorkflowDefinition } from '@olly/shared-types';
import { DelayedError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { BINARY_STORAGE } from '../binary/binary.module.js';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { createRedisConnection } from '../core/redis.js';
import { DB, REDIS } from '../core/tokens.js';
import { ExecutionEventSink } from '../executions/execution-events.service.js';
import type { CancelMessage, ExecutionJob } from '../executions/execution-job.js';
import { ErrorWorkflowTrigger } from '../executions/error-workflow.js';
import { ExecutionRunner } from '../executions/execution-runner.js';
import { ResultPublisher } from '../executions/result-bus.js';
import {
  CANCEL_CHANNEL,
  EXECUTIONS_QUEUE,
  RESUME_JOB,
  type ExecutionJobData,
} from '../queue/constants.js';
import { ExecutionWaits } from '../executions/waits.service.js';
import { ApprovalsService } from '../ai/approvals.service.js';
import { loadPayload } from '../queue/payloads.js';
import { ProjectQuota } from '../queue/quota.js';
import { markWorkerLost, type WorkerLostDeps } from '../queue/worker-lost.js';

/** Pedidos de cancelamento que chegaram antes de a execução começar aqui. */
const EARLY_CANCEL_TTL_MS = 60_000;
/** Varredura das retomadas vencidas (garantia caso um job atrasado se perca, spec 008). */
const RESUME_SWEEP_MS = 30_000;
/** Tolerância para retomar um Wait cujo horário está para vencer. */
const RESUME_TOLERANCE_MS = 1000;

type ClaimedExecution = {
  mode: 'test' | 'production';
  trigger_type: string;
  definition: unknown;
  project_id: string;
  workflow_id: string;
  workflow_name: string;
  active: boolean;
};

export interface WorkerStats {
  concurrency: number;
  active: number;
  processed: number;
  failed: number;
  delayedByQuota: number;
  shuttingDown: boolean;
}

/**
 * Consumidor da fila `executions` (spec 006, plan §2): carrega a execução e o payload, ocupa
 * uma vaga da cota do projeto (FR-012), marca `running` e executa com o mesmo `ExecutionRunner`
 * da API. Cancelamentos chegam pelo Redis (FR-010); no SIGTERM, para de consumir e espera as
 * execuções em andamento até o limite (FR-004).
 */
@Injectable()
export class ExecutionProcessor {
  private readonly logger = new Logger('Worker');
  private worker?: Worker<ExecutionJobData>;
  private connection?: Redis;
  private subscriber?: Redis;
  private heartbeat?: NodeJS.Timeout;
  private resumeSweep?: NodeJS.Timeout;
  private readonly active = new Map<string, { controller: AbortController; projectId: string }>();
  private readonly earlyCancels = new Map<string, { message: CancelMessage; at: number }>();
  private readonly results: ResultPublisher;
  private readonly quota: ProjectQuota;
  private readonly lost: WorkerLostDeps;
  private counters = { processed: 0, failed: 0, delayedByQuota: 0 };
  private shuttingDown = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) redis: Redis,
    @Inject(ExecutionRunner) private readonly runner: ExecutionRunner,
    @Inject(ExecutionEventSink) events: ExecutionEventSink,
    @Inject(BINARY_STORAGE) private readonly binaries: S3BinaryStorage | null,
    @Inject(ErrorWorkflowTrigger) private readonly errorWorkflows: ErrorWorkflowTrigger,
    @Inject(ExecutionWaits) private readonly waits: ExecutionWaits,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {
    this.results = new ResultPublisher(redis);
    this.quota = new ProjectQuota(redis, config.queue.staleAfterMs);
    this.lost = {
      db,
      events,
      results: this.results,
      quota: this.quota,
      logger: this.logger,
      errorWorkflows,
    };
  }

  get stats(): WorkerStats {
    return {
      concurrency: this.config.queue.workerConcurrency,
      active: this.active.size,
      ...this.counters,
      shuttingDown: this.shuttingDown,
    };
  }

  async start(): Promise<void> {
    this.subscriber = createRedisConnection(this.config.redisUrl, 'cancel');
    this.subscriber.on('message', (_channel: string, raw: string) => {
      this.onCancel(raw);
    });
    await this.subscriber.subscribe(CANCEL_CHANNEL);

    this.connection = createRedisConnection(this.config.redisUrl, 'worker');
    this.worker = new Worker<ExecutionJobData>(
      EXECUTIONS_QUEUE,
      (job, token) => this.process(job, token),
      {
        connection: this.connection,
        concurrency: this.config.queue.workerConcurrency,
        // FR-005: job travado (worker caiu) falha em vez de voltar para a fila.
        maxStalledCount: 0,
      },
    );
    this.worker.on('failed', (job, error) => {
      if (!job || !/stalled/i.test(error.message)) return;
      void markWorkerLost(this.lost, { executionId: job.data.executionId });
    });
    this.worker.on('error', (error) => {
      this.logger.warn(`Erro na fila: ${error.message}`);
    });
    this.heartbeat = setInterval(() => void this.refreshLeases(), this.config.queue.heartbeatMs);
    this.heartbeat.unref();
    this.resumeSweep = setInterval(() => {
      this.waits.sweepDue().catch((e: unknown) => {
        this.logger.warn(`Varredura de retomadas falhou: ${String(e)}`);
      });
      // Spec 011, NFR-002: aprovações vencidas são rejeitadas automaticamente.
      this.approvals.expireDue().catch((e: unknown) => {
        this.logger.warn(`Expiração de aprovações falhou: ${String(e)}`);
      });
    }, RESUME_SWEEP_MS);
    this.resumeSweep.unref();
    await this.worker.waitUntilReady();
    this.logger.log(
      `Worker consumindo a fila "${EXECUTIONS_QUEUE}" (concorrência ${this.config.queue.workerConcurrency})`,
    );
  }

  private async process(job: Job<ExecutionJobData>, token?: string): Promise<void> {
    if (job.name === RESUME_JOB) return this.processResume(job, token);
    const { executionId } = job.data;
    const execution = await this.db
      .selectFrom('executions as e')
      .innerJoin('workflows as w', 'w.id', 'e.workflow_id')
      .innerJoin('projects as p', 'p.id', 'e.project_id')
      .select([
        'e.status',
        'e.mode',
        'e.trigger_type',
        'e.definition',
        'e.project_id',
        'w.id as workflow_id',
        'w.name as workflow_name',
        'w.active',
        'p.max_concurrent_executions',
      ])
      .where('e.id', '=', executionId)
      .executeTakeFirst();
    // Cancelada na fila ou já tratada: nada a fazer (nunca reexecuta, FR-005).
    if (execution?.status !== 'queued') return;
    const projectId = execution.project_id;
    const limit = execution.max_concurrent_executions ?? this.config.queue.projectMaxConcurrent;
    if (!(await this.quota.acquire(projectId, executionId, limit))) {
      // FR-012: sem vaga, continua `queued` e tenta de novo em instantes.
      this.counters.delayedByQuota++;
      await job.moveToDelayed(Date.now() + this.config.queue.quotaRetryMs, token);
      throw new DelayedError();
    }
    try {
      const claimed = await this.db
        .updateTable('executions')
        .set({ status: 'running', heartbeat_at: new Date() })
        .where('id', '=', executionId)
        .where('status', '=', 'queued')
        .executeTakeFirst();
      if (claimed.numUpdatedRows === 0n) return;
      const payload = await loadPayload(this.db, this.binaries, executionId);
      await this.run(executionId, execution, {
        executionId,
        workflow: {
          id: execution.workflow_id,
          name: execution.workflow_name,
          projectId,
          active: execution.active,
        },
        definition: execution.definition as WorkflowDefinition,
        mode: execution.mode,
        ...payload,
      });
    } finally {
      this.active.delete(executionId);
      this.earlyCancels.delete(executionId);
      await this.quota.release(projectId, executionId).catch(() => undefined);
    }
  }

  /** Executa uma execução já marcada `running` e publica o desfecho. */
  private async run(
    executionId: string,
    execution: ClaimedExecution,
    executionJob: ExecutionJob,
  ): Promise<void> {
    const projectId = execution.project_id;
    const controller = new AbortController();
    this.active.set(executionId, { controller, projectId });
    const early = this.earlyCancels.get(executionId);
    if (early)
      controller.abort(new ExecutionCancelledError(early.message.reason, early.message.message));
    const outcome = await this.runner.execute(executionJob, {
      signal: controller.signal,
      onWebhookResponse: (response) => {
        this.results.response(executionId, response).catch((e: unknown) => {
          this.logger.warn(`Resposta do webhook de ${executionId} não publicada: ${String(e)}`);
        });
      },
    });
    // Spec 008: a execução em espera ainda não tem desfecho.
    if (outcome.status === 'waiting') return;
    await this.results.finished(executionId, outcome).catch((e: unknown) => {
      this.logger.warn(`Desfecho de ${executionId} não publicado: ${String(e)}`);
    });
    if (outcome.status === 'success') this.counters.processed++;
    else this.counters.failed++;
    if (outcome.status === 'error') {
      await this.errorWorkflows.trigger({
        executionId,
        workflowId: execution.workflow_id,
        workflowName: execution.workflow_name,
        projectId,
        mode: execution.mode,
        triggerType: execution.trigger_type,
        definition: executionJob.definition,
        error: outcome.error ?? { message: 'Erro desconhecido' },
      });
    }
  }

  /**
   * Retomada de uma execução em espera (spec 008, FR-012): qualquer worker restaura o estado
   * salvo e executa de novo os nós cujo tempo venceu ou que receberam um valor (ex.: decisão
   * de aprovação, spec 011).
   */
  private async processResume(job: Job<ExecutionJobData>, token?: string): Promise<void> {
    const { executionId } = job.data;
    const execution = await this.db
      .selectFrom('executions as e')
      .innerJoin('workflows as w', 'w.id', 'e.workflow_id')
      .innerJoin('projects as p', 'p.id', 'e.project_id')
      .select([
        'e.status',
        'e.mode',
        'e.trigger_type',
        'e.definition',
        'e.project_id',
        'w.id as workflow_id',
        'w.name as workflow_name',
        'w.active',
        'p.max_concurrent_executions',
      ])
      .where('e.id', '=', executionId)
      .executeTakeFirst();
    if (execution?.status !== 'waiting') return;
    const stored = await this.waits.load(executionId);
    if (!stored) return;
    const now = Date.now();
    const values: Record<string, unknown> = {};
    for (const w of stored.engine.waiting) {
      if (Object.hasOwn(stored.deliveries, w.nodeId))
        values[w.nodeId] = stored.deliveries[w.nodeId];
      else if (w.request.resumeAt && Date.parse(w.request.resumeAt) <= now + RESUME_TOLERANCE_MS) {
        values[w.nodeId] = { kind: 'time' };
      }
    }
    if (Object.keys(values).length === 0) {
      // Cedo demais (ex.: job duplicado): reagenda para o próximo horário, se houver.
      const next = ExecutionWaits.nextResumeAt(stored.engine);
      if (next && next.getTime() > now) await this.waits.schedule(executionId, next);
      return;
    }
    const projectId = execution.project_id;
    const limit = execution.max_concurrent_executions ?? this.config.queue.projectMaxConcurrent;
    if (!(await this.quota.acquire(projectId, executionId, limit))) {
      this.counters.delayedByQuota++;
      await job.moveToDelayed(Date.now() + this.config.queue.quotaRetryMs, token);
      throw new DelayedError();
    }
    try {
      const claimed = await this.db
        .updateTable('executions')
        .set({ status: 'running', heartbeat_at: new Date() })
        .where('id', '=', executionId)
        .where('status', '=', 'waiting')
        .executeTakeFirst();
      if (claimed.numUpdatedRows === 0n) return;
      await this.run(executionId, execution, {
        executionId,
        workflow: {
          id: execution.workflow_id,
          name: execution.workflow_name,
          projectId,
          active: execution.active,
        },
        definition: execution.definition as WorkflowDefinition,
        mode: execution.mode,
        ...stored.job,
        resume: { snapshot: stored.engine, values },
      });
    } finally {
      this.active.delete(executionId);
      this.earlyCancels.delete(executionId);
      await this.quota.release(projectId, executionId).catch(() => undefined);
    }
  }

  private onCancel(raw: string): void {
    let message: CancelMessage;
    try {
      message = JSON.parse(raw) as CancelMessage;
    } catch {
      return;
    }
    const active = this.active.get(message.executionId);
    if (active) {
      this.logger.log(`Cancelando a execução ${message.executionId}`);
      active.controller.abort(new ExecutionCancelledError(message.reason, message.message));
      return;
    }
    // Pode ter chegado entre a marcação `running` e o registro local: guarda por um tempo.
    const now = Date.now();
    this.earlyCancels.set(message.executionId, { message, at: now });
    for (const [id, entry] of this.earlyCancels) {
      if (now - entry.at > EARLY_CANCEL_TTL_MS) this.earlyCancels.delete(id);
    }
  }

  private async refreshLeases(): Promise<void> {
    await Promise.allSettled(
      [...this.active].map(([executionId, { projectId }]) =>
        this.quota.refresh(projectId, executionId),
      ),
    );
  }

  /**
   * Encerramento gracioso (FR-004): para de consumir e espera as execuções em andamento até
   * `timeoutMs`. As que não terminarem a tempo são interrompidas e terminam como
   * `error`/`worker_lost`, sem voltar para a fila (FR-005); os jobs ainda não iniciados ficam
   * na fila para outro worker.
   */
  async close(timeoutMs = this.config.queue.workerShutdownTimeoutMs): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    clearInterval(this.heartbeat);
    clearInterval(this.resumeSweep);
    if (this.worker) {
      const closing = this.worker.close();
      const timedOut = await Promise.race([
        closing.then(() => false),
        new Promise<boolean>((resolve) =>
          setTimeout(() => {
            resolve(true);
          }, timeoutMs).unref(),
        ),
      ]);
      if (timedOut) {
        this.logger.warn(
          `${this.active.size} execução(ões) não terminaram em ${timeoutMs} ms; interrompendo`,
        );
        for (const { controller } of this.active.values()) {
          controller.abort(
            new ExecutionCancelledError(
              'worker_lost',
              'O worker foi encerrado antes do fim da execução',
            ),
          );
        }
        await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
      }
    }
    this.subscriber?.disconnect();
    this.connection?.disconnect();
  }
}
