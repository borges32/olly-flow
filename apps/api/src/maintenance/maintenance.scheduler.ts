import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { createRedisConnection } from '../core/redis.js';
import { MaintenanceService } from './maintenance.service.js';

export const MAINTENANCE_QUEUE = 'maintenance';
const SCHEDULER_ID = 'maintenance-daily';

/**
 * Agenda o job diário de manutenção (spec 009, plan §7) como *job scheduler* do BullMQ: um único
 * agendamento, qualquer que seja o número de workers; o lock do `MaintenanceService` cobre
 * execuções manuais concorrentes.
 */
@Injectable()
export class MaintenanceScheduler {
  private readonly logger = new Logger('Maintenance');
  private queue?: Queue;
  private worker?: Worker;
  private connections: Redis[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MaintenanceService) private readonly maintenance: MaintenanceService,
  ) {}

  async start(): Promise<void> {
    const queueConnection = createRedisConnection(this.config.redisUrl, 'maintenance-queue');
    const workerConnection = createRedisConnection(this.config.redisUrl, 'maintenance-worker');
    this.connections = [queueConnection, workerConnection];
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: queueConnection });
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { pattern: this.config.governance.maintenanceCron, tz: this.config.execution.timezone },
      { name: 'retention', opts: { removeOnComplete: 30, removeOnFail: 30 } },
    );
    this.worker = new Worker(
      MAINTENANCE_QUEUE,
      async () => {
        await this.maintenance.run();
      },
      { connection: workerConnection, concurrency: 1 },
    );
    this.worker.on('failed', (_job, error) => {
      this.logger.error(`Manutenção falhou: ${error.message}`);
    });
  }

  /** Com o Redis fora do ar, o BullMQ esperaria para sempre: limite de 5 s e desconexão. */
  async close(): Promise<void> {
    const closing = Promise.allSettled([this.worker?.close(), this.queue?.close()]);
    await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
    for (const c of this.connections) c.disconnect();
  }
}
