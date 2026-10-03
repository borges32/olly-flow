import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { DependencyStatus, HealthResponse } from '@olly/shared-types';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import { OidcTokenVerifier } from '../auth/token-verifier.js';
import { DB, REDIS } from '../core/tokens.js';

const CHECK_TIMEOUT_MS = 2000;

async function probe(check: () => Promise<unknown>): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(OidcTokenVerifier) private readonly verifier: OidcTokenVerifier,
  ) {}

  /**
   * Banco e Redis são essenciais (`error` → 503). O IdP fora do ar só degrada: a API segue
   * no ar e quem já validou tokens continua atendido enquanto as chaves estiverem em cache.
   */
  async check(): Promise<HealthResponse> {
    const [db, redis, idp] = await Promise.all([
      probe(() => sql`SELECT 1`.execute(this.db)),
      probe(() => this.redis.ping()),
      probe(async () => {
        if (!(await this.verifier.isIssuerReachable())) throw new Error('idp down');
      }),
    ]);
    const status = db === 'down' || redis === 'down' ? 'error' : idp === 'down' ? 'degraded' : 'ok';
    return { status, db, redis, idp };
  }
}
