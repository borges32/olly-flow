import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlFileMigrationProvider, migrateDown, migrateToLatest } from './index.js';
import { startTestDatabase, type TestDatabase } from './testing.js';

const TABLES = [
  'audit_log',
  'executions',
  'node_executions',
  'project_members',
  'projects',
  'roles',
  'users',
  'webhooks',
  'workflow_versions',
  'workflows',
];

let t: TestDatabase;

async function publicTables(): Promise<string[]> {
  // Partições mensais (executions_202610...) não contam: só as tabelas-mãe.
  const { rows } = await sql<{ table_name: string }>`
    SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND c.relname NOT LIKE 'kysely_%'
    ORDER BY c.relname`.execute(t.db);
  return rows.map((r) => r.table_name);
}

beforeAll(async () => {
  t = await startTestDatabase({ migrate: false, seed: false });
});
afterAll(async () => {
  await t.stop();
});

describe('FR-009: migrations versionadas e reversíveis', () => {
  it('FR-009/SC-003: up cria as tabelas da fundação', async () => {
    const applied = await migrateToLatest(t.db);
    expect(applied).toEqual(['Up 0001_fundacao', 'Up 0002_workflows', 'Up 0003_executions']);
    expect(await publicTables()).toEqual(TABLES);
  });

  it('FR-009: up é idempotente quando não há pendências', async () => {
    expect(await migrateToLatest(t.db)).toEqual([]);
  });

  it('FR-009/SC-003: down reverte tudo e up reaplica sem erro', async () => {
    const reverted = await migrateDown(t.db, { all: true });
    expect(reverted).toEqual(['Down 0003_executions', 'Down 0002_workflows', 'Down 0001_fundacao']);
    expect(await publicTables()).toEqual([]);
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'audit_log_immutable'`.execute(t.db);
    expect(rows[0]?.n).toBe(0);

    await migrateToLatest(t.db);
    expect(await publicTables()).toEqual(TABLES);
  });

  it('FR-001/FR-002 (spec 002): down de 0003 e 0002 remove só as tabelas delas', async () => {
    await migrateDown(t.db);
    expect(await publicTables()).toEqual(TABLES.filter((n) => !n.includes('executions')));
    await migrateDown(t.db);
    expect(await publicTables()).toEqual(
      TABLES.filter((n) => !n.includes('executions') && !n.startsWith('w')),
    );
    await migrateToLatest(t.db);
  });

  it('FR-009: recusa migration sem arquivo down', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'olly-mig-'));
    await writeFile(join(dir, '0001_x.up.sql'), 'SELECT 1;');
    await expect(new SqlFileMigrationProvider(dir).getMigrations()).rejects.toThrow(/reversível/);
  });
});
