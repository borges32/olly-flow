import pg from 'pg';
import type { ResolvedCredential } from '../credentials/definitions.js';

export const DEFAULT_PG_POOL_MAX = 5;
const IDLE_POOL_MS = 5 * 60_000;
const CONNECT_TIMEOUT_MS = 10_000;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Configuração de conexão a partir da credencial `postgres` (plan §3). */
export function connectionConfig(data: Record<string, unknown>): pg.ClientConfig {
  const host = str(data.host);
  const ssl = data.ssl;
  const ca = str(data.caCert).trim();
  return {
    host,
    port: typeof data.port === 'number' ? data.port : 5432,
    database: str(data.database),
    user: str(data.user),
    password: str(data.password),
    application_name: 'olly-flow',
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    // `require` segue o libpq (cifra sem verificar); `verify-full` verifica certificado e host.
    ssl:
      ssl === 'verify-full'
        ? { rejectUnauthorized: true, servername: host, ...(ca && { ca }) }
        : ssl === 'require'
          ? { rejectUnauthorized: false }
          : false,
  };
}

interface Entry {
  pool: pg.Pool;
  lastUsed: number;
}

/**
 * Pools por credencial (NFR-002, plan §6). A chave `id:updatedAt` faz uma credencial alterada
 * ganhar pool novo; o antigo e os ociosos são fechados.
 */
export class PoolManager {
  private readonly pools = new Map<string, Entry>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly options: {
      max?: number;
      idleMs?: number;
      onError?: (err: Error) => void;
    } = {},
  ) {
    this.timer = setInterval(() => void this.sweep(), 60_000);
    this.timer.unref();
  }

  get(credential: ResolvedCredential): pg.Pool {
    const key = `${credential.id}:${credential.updatedAt}`;
    const existing = this.pools.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.pool;
    }
    for (const [k, entry] of this.pools) {
      if (k.startsWith(`${credential.id}:`)) {
        this.pools.delete(k);
        void entry.pool.end().catch(() => undefined);
      }
    }
    const pool = new pg.Pool({
      ...connectionConfig(credential.data),
      max: this.options.max ?? DEFAULT_PG_POOL_MAX,
      idleTimeoutMillis: 30_000,
    });
    // Erro numa conexão ociosa (ex.: banco reiniciado) não pode derrubar o processo.
    pool.on('error', (err) => this.options.onError?.(err));
    this.pools.set(key, { pool, lastUsed: Date.now() });
    return pool;
  }

  get size(): number {
    return this.pools.size;
  }

  async sweep(now = Date.now()): Promise<void> {
    const idle = this.options.idleMs ?? IDLE_POOL_MS;
    const stale = [...this.pools].filter(([, e]) => now - e.lastUsed > idle);
    for (const [key] of stale) this.pools.delete(key);
    await Promise.allSettled(stale.map(([, e]) => e.pool.end()));
  }

  async closeAll(): Promise<void> {
    clearInterval(this.timer);
    const all = [...this.pools.values()];
    this.pools.clear();
    await Promise.allSettled(all.map((e) => e.pool.end()));
  }
}
