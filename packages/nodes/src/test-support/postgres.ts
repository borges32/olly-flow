import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { ResolvedCredential } from '../credentials/definitions.js';

export interface ExternalPostgres {
  container: StartedPostgreSqlContainer;
  /** Conexão administrativa para preparar e conferir os dados. */
  admin: pg.Pool;
  credential(extra?: Record<string, unknown>, id?: string): ResolvedCredential;
  stop(): Promise<void>;
}

/** Banco "externo" dos nós Postgres (plan §9): um PostgreSQL 16 descartável. */
export async function startExternalPostgres(): Promise<ExternalPostgres> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const data = {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getPassword(),
    ssl: 'disable',
    readOnly: false,
  };
  const admin = new pg.Pool({ ...data, ssl: false, max: 3 });
  return {
    container,
    admin,
    credential: (extra = {}, id = 'cred-pg') => ({
      id,
      type: 'postgres',
      data: { ...data, ...extra },
      updatedAt: '2026-10-04T00:00:00.000Z',
    }),
    stop: async () => {
      await admin.end();
      await container.stop();
    },
  };
}
