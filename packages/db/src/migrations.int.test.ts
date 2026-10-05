import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlFileMigrationProvider, migrateDown, migrateToLatest } from './index.js';
import { startTestDatabase, type TestDatabase } from './testing.js';

const TABLES = [
  'audit_log',
  'credentials',
  'execution_payloads',
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
    expect(applied).toEqual([
      'Up 0001_fundacao',
      'Up 0002_workflows',
      'Up 0003_executions',
      'Up 0004_node_reused',
      'Up 0005_credentials',
      'Up 0006_publish_console',
      'Up 0007_queue',
      'Up 0008_error_workflow',
    ]);
    expect(await publicTables()).toEqual(TABLES);
  });

  it('FR-009: up é idempotente quando não há pendências', async () => {
    expect(await migrateToLatest(t.db)).toEqual([]);
  });

  it('FR-009/SC-003: down reverte tudo e up reaplica sem erro', async () => {
    const reverted = await migrateDown(t.db, { all: true });
    expect(reverted).toEqual([
      'Down 0008_error_workflow',
      'Down 0007_queue',
      'Down 0006_publish_console',
      'Down 0005_credentials',
      'Down 0004_node_reused',
      'Down 0003_executions',
      'Down 0002_workflows',
      'Down 0001_fundacao',
    ]);
    expect(await publicTables()).toEqual([]);
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'audit_log_immutable'`.execute(t.db);
    expect(rows[0]?.n).toBe(0);

    await migrateToLatest(t.db);
    expect(await publicTables()).toEqual(TABLES);
  });

  it('FR-014 (spec 007): down de 0008 remove só a coluna error_workflow_id', async () => {
    const column = async () => {
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'workflows' AND column_name = 'error_workflow_id'`.execute(t.db);
      return rows[0]?.n;
    };
    expect(await column()).toBe(1);
    expect(await migrateDown(t.db)).toEqual(['Down 0008_error_workflow']);
    expect(await column()).toBe(0);
    expect(await publicTables()).toEqual(TABLES);
    await migrateToLatest(t.db);
  });

  it('FR-001/FR-005/FR-012 (spec 006): down de 0007 remove só a tabela de payloads, o batimento e a cota', async () => {
    const columns = async () => {
      const { rows } = await sql<{ name: string }>`
        SELECT table_name || '.' || column_name AS name FROM information_schema.columns
        WHERE (table_name, column_name) IN (('executions', 'heartbeat_at'),
          ('projects', 'max_concurrent_executions'))
        ORDER BY 1`.execute(t.db);
      return rows.map((r) => r.name);
    };
    expect(await columns()).toEqual([
      'executions.heartbeat_at',
      'projects.max_concurrent_executions',
    ]);
    await migrateDown(t.db);
    expect(await migrateDown(t.db)).toEqual(['Down 0007_queue']);
    expect(await columns()).toEqual([]);
    expect(await publicTables()).toEqual(TABLES.filter((n) => n !== 'execution_payloads'));
    await migrateToLatest(t.db);
  });

  it('FR-001/FR-012 (spec 005): down de 0006 remove só as colunas de publicação e console', async () => {
    const columns = async () => {
      const { rows } = await sql<{ name: string }>`
        SELECT table_name || '.' || column_name AS name FROM information_schema.columns
        WHERE (table_name, column_name) IN (('workflows', 'published_version'), ('workflows', 'active'),
          ('executions', 'definition'), ('node_executions', 'console'))
        ORDER BY 1`.execute(t.db);
      return rows.map((r) => r.name);
    };
    expect(await columns()).toEqual([
      'executions.definition',
      'node_executions.console',
      'workflows.active',
      'workflows.published_version',
    ]);
    await migrateDown(t.db);
    await migrateDown(t.db);
    expect(await migrateDown(t.db)).toEqual(['Down 0006_publish_console']);
    expect(await columns()).toEqual([]);
    expect(await publicTables()).toEqual(TABLES.filter((n) => n !== 'execution_payloads'));
    await migrateToLatest(t.db);
  });

  it('FR-001 (spec 004): down de 0005 remove só a tabela credentials', async () => {
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    expect(await migrateDown(t.db)).toEqual(['Down 0005_credentials']);
    expect(await publicTables()).toEqual(
      TABLES.filter((n) => n !== 'credentials' && n !== 'execution_payloads'),
    );
    await migrateToLatest(t.db);
  });

  it('FR-020 (spec 003): down de 0004 remove só a coluna reused', async () => {
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    const reusedColumns = async () => {
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'node_executions' AND column_name = 'reused'`.execute(t.db);
      return rows[0]?.n;
    };
    expect(await reusedColumns()).toBe(1);
    expect(await migrateDown(t.db)).toEqual(['Down 0004_node_reused']);
    expect(await reusedColumns()).toBe(0);
    expect(await publicTables()).toEqual(
      TABLES.filter((n) => n !== 'credentials' && n !== 'execution_payloads'),
    );
    await migrateToLatest(t.db);
  });

  it('FR-001/FR-002 (spec 002): down de 0003 e 0002 remove só as tabelas delas', async () => {
    const base = TABLES.filter((n) => n !== 'credentials' && n !== 'execution_payloads');
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    await migrateDown(t.db);
    expect(await publicTables()).toEqual(base.filter((n) => !n.includes('executions')));
    await migrateDown(t.db);
    expect(await publicTables()).toEqual(
      base.filter((n) => !n.includes('executions') && !n.startsWith('w')),
    );
    await migrateToLatest(t.db);
  });

  it('FR-009: recusa migration sem arquivo down', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'olly-mig-'));
    await writeFile(join(dir, '0001_x.up.sql'), 'SELECT 1;');
    await expect(new SqlFileMigrationProvider(dir).getMigrations()).rejects.toThrow(/reversível/);
  });
});
