import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, REDIS } from '../core/tokens.js';
import { ProjectQuota } from '../queue/quota.js';

/** Vaga de um stream aberto: renovada pelo sinal periódico e liberada no fim. */
export interface StreamSlot {
  refresh(): void;
  release(): void;
}

/**
 * Limite de streams simultâneos por projeto (spec 027, FR-006, plan §5): o mesmo semáforo com
 * validade da cota de execuções (spec 006), na chave `olly:streams:<projeto>`. Vale entre
 * instâncias da API; a vaga de uma instância que caiu vence sozinha.
 */
@Injectable()
export class StreamLimiter {
  private readonly logger = new Logger('StreamLimiter');
  private readonly slots: ProjectQuota;

  constructor(
    @Inject(REDIS) redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
  ) {
    this.slots = new ProjectQuota(redis, config.webhook.streamPingMs * 2, 'olly:streams');
  }

  private async limitOf(projectId: string): Promise<number> {
    const row = await this.db
      .selectFrom('projects')
      .select('max_webhook_streams')
      .where('id', '=', projectId)
      .executeTakeFirst();
    return row?.max_webhook_streams ?? this.config.webhook.streamMaxPerProject;
  }

  /** Ocupa uma vaga do projeto, ou devolve o limite atingido. */
  async acquire(projectId: string): Promise<{ slot: StreamSlot } | { limit: number }> {
    const limit = await this.limitOf(projectId);
    const id = randomUUID();
    let ok: boolean;
    try {
      ok = await this.slots.acquire(projectId, id, limit);
    } catch (error) {
      // Sem Redis, a fila também está fora; o stream não é bloqueado por isso.
      this.logger.warn(`Limite de streams não conferido (Redis): ${String(error)}`);
      ok = true;
    }
    if (!ok) return { limit };
    const ignore = (error: unknown) => {
      this.logger.warn(`Vaga do stream ${id}: ${String(error)}`);
    };
    return {
      slot: {
        refresh: () => {
          this.slots.refresh(projectId, id).catch(ignore);
        },
        release: () => {
          this.slots.release(projectId, id).catch(ignore);
        },
      },
    };
  }
}
