import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Db } from '@olly/db';
import type { EngineSnapshot } from '@olly/engine';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { EXECUTIONS_QUEUE, RESUME_JOB, type ExecutionJobData } from '../queue/constants.js';
import type { ExecutionPayload } from './execution-job.js';

/** Estado guardado de uma execução em espera (spec 008, FR-012, plan §5). */
export interface StoredExecutionState {
  engine: EngineSnapshot;
  /** Dados do disparo que a retomada ainda usa (nó inicial, destino, pin data). */
  job: Pick<ExecutionPayload, 'startNodeId' | 'destinationNodeId' | 'pinData'>;
  /** Valores entregues aos nós em espera (ex.: decisões de aprovação, spec 011). */
  deliveries: Record<string, unknown>;
}

/**
 * Esperas das execuções (spec 008, FR-012): grava o estado do motor em `execution_state`,
 * agenda a retomada (job atrasado na fila `executions`) e recebe os valores que retomam nós
 * (ex.: decisão de aprovação). Usado pela API e pelos workers; só os workers retomam.
 */
@Injectable()
export class ExecutionWaits implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('ExecutionWaits');
  private producer?: Redis;
  private queue?: Queue<ExecutionJobData>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.producer = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: 1,
      connectionName: 'olly-resume-producer',
    });
    this.producer.on('error', () => undefined);
    this.queue = new Queue(EXECUTIONS_QUEUE, { connection: this.producer });
    this.queue.on('error', (error) => {
      this.logger.warn(`Fila indisponível: ${error.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
    this.producer?.disconnect();
  }

  /** Próxima retomada por tempo entre os nós em espera. */
  static nextResumeAt(engine: EngineSnapshot): Date | null {
    const times = engine.waiting
      .map((w) => (w.request.resumeAt ? Date.parse(w.request.resumeAt) : NaN))
      .filter((t) => Number.isFinite(t));
    return times.length > 0 ? new Date(Math.min(...times)) : null;
  }

  async save(
    executionId: string,
    engine: EngineSnapshot,
    job: StoredExecutionState['job'],
  ): Promise<void> {
    const state: StoredExecutionState = { engine, job, deliveries: {} };
    const resumeAt = ExecutionWaits.nextResumeAt(engine);
    await this.db
      .insertInto('execution_state')
      .values({ execution_id: executionId, state: JSON.stringify(state), resume_at: resumeAt })
      .onConflict((oc) =>
        oc.column('execution_id').doUpdateSet({
          state: JSON.stringify(state),
          resume_at: resumeAt,
          updated_at: new Date(),
        }),
      )
      .execute();
    if (resumeAt) await this.schedule(executionId, resumeAt);
  }

  async load(executionId: string): Promise<StoredExecutionState | null> {
    const row = await this.db
      .selectFrom('execution_state')
      .select('state')
      .where('execution_id', '=', executionId)
      .executeTakeFirst();
    return (row?.state as StoredExecutionState | undefined) ?? null;
  }

  async clear(executionId: string): Promise<void> {
    await this.db.deleteFrom('execution_state').where('execution_id', '=', executionId).execute();
  }

  /** Agenda a retomada (um job por horário; a retomada ignora a execução que não espera). */
  async schedule(executionId: string, at: Date = new Date()): Promise<void> {
    if (!this.queue) throw new Error('Fila de execuções não inicializada');
    await this.queue.add(
      RESUME_JOB,
      { executionId },
      {
        jobId: `resume-${executionId}-${String(at.getTime())}`,
        delay: Math.max(0, at.getTime() - Date.now()),
        attempts: 1,
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600 },
      },
    );
  }

  /**
   * Entrega um valor a um nó em espera (spec 011: decisão de aprovação) e, se `resumeNow`,
   * agenda a retomada imediata. `merge` combina com o que já foi entregue ao nó.
   */
  async deliver(
    executionId: string,
    nodeId: string,
    merge: (current: unknown) => unknown,
    resumeNow: boolean,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('execution_state')
        .select('state')
        .where('execution_id', '=', executionId)
        .forUpdate()
        .executeTakeFirst();
      if (!row) throw new Error('Execução sem estado de espera');
      const state = row.state as StoredExecutionState;
      state.deliveries[nodeId] = merge(state.deliveries[nodeId]);
      await trx
        .updateTable('execution_state')
        .set({ state: JSON.stringify(state), updated_at: new Date() })
        .where('execution_id', '=', executionId)
        .execute();
    });
    if (resumeNow) await this.schedule(executionId);
  }

  /** Garantia caso um job atrasado se perca: reagenda as retomadas vencidas. */
  async sweepDue(now = new Date()): Promise<number> {
    const rows = await this.db
      .selectFrom('execution_state as s')
      .innerJoin('executions as e', 'e.id', 's.execution_id')
      .select(['s.execution_id', 's.resume_at'])
      .where('e.status', '=', 'waiting')
      .where('s.resume_at', '<=', now)
      .limit(500)
      .execute();
    for (const row of rows) {
      await this.schedule(row.execution_id, row.resume_at ?? now).catch((e: unknown) => {
        this.logger.warn(`Retomada de ${row.execution_id} não agendada: ${String(e)}`);
      });
    }
    return rows.length;
  }
}
