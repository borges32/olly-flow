import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Db } from '@olly/db';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, REDIS } from '../core/tokens.js';
import { ExecutionEventSink } from '../executions/execution-events.service.js';
import { ErrorWorkflowTrigger } from '../executions/error-workflow.js';
import { ResultPublisher } from '../executions/result-bus.js';
import { ProjectQuota } from './quota.js';
import { markWorkerLost, type WorkerLostDeps } from './worker-lost.js';

/**
 * Varredura de segurança (spec 006, FR-005, plan §2): periodicamente, execuções `running` sem
 * batimento há mais de `staleAfterMs` terminam como `worker_lost`. Idempotente entre várias
 * instâncias da API (atualização condicional).
 */
@Injectable()
export class WorkerLostSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WorkerLost');
  private timer?: NodeJS.Timeout;
  private readonly deps: WorkerLostDeps;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) db: Db,
    @Inject(REDIS) redis: Redis,
    @Inject(ExecutionEventSink) events: ExecutionEventSink,
    @Inject(ErrorWorkflowTrigger) errorWorkflows: ErrorWorkflowTrigger,
  ) {
    this.deps = {
      errorWorkflows,
      db,
      events,
      results: new ResultPublisher(redis),
      quota: new ProjectQuota(redis, config.queue.staleAfterMs),
      logger: this.logger,
    };
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), this.config.queue.sweepIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async sweep(): Promise<string[]> {
    try {
      return await markWorkerLost(this.deps, {
        staleBefore: new Date(Date.now() - this.config.queue.staleAfterMs),
      });
    } catch (error) {
      this.logger.warn(`Varredura de execuções sem batimento falhou: ${String(error)}`);
      return [];
    }
  }
}
