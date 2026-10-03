import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

export type Db = Kysely<Database>;

export interface CreateDbOptions {
  connectionString: string;
  max?: number;
  /** Erros de conexões ociosas (ex.: banco reiniciado). O pool já descarta a conexão. */
  onPoolError?: (error: Error) => void;
}

export function createDb({ connectionString, max = 10, onPoolError }: CreateDbOptions): Db {
  const pool = new pg.Pool({ connectionString, max });
  // Sem um listener, o `error` de uma conexão ociosa derruba o processo.
  pool.on('error', (error) => onPoolError?.(error));
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
