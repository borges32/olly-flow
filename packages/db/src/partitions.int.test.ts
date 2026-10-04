import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './testing.js';

let t: TestDatabase;

beforeAll(async () => {
  t = await startTestDatabase();
});
afterAll(async () => {
  await t.stop();
});

async function partitions(parent: string): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`
    SELECT c.relname AS name FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = ${parent} ORDER BY c.relname`.execute(t.db);
  return rows.map((r) => r.name);
}

describe('spec 003 — FR-014: log de execuções particionado por mês', () => {
  it('FR-014: a migration cria partições do mês corrente e dos dois seguintes', async () => {
    for (const parent of ['executions', 'node_executions']) {
      const names = await partitions(parent);
      expect(names).toHaveLength(3);
      expect(names.every((n) => new RegExp(`^${parent}_\\d{6}$`).test(n))).toBe(true);
    }
  });

  it('FR-014: olly_ensure_partitions é idempotente e cria meses à frente', async () => {
    await sql`SELECT olly_ensure_partitions(2)`.execute(t.db);
    expect(await partitions('executions')).toHaveLength(3);
    await sql`SELECT olly_ensure_partitions(5)`.execute(t.db);
    expect(await partitions('node_executions')).toHaveLength(6);
  });

  it('FR-014: grava execução e nós na partição do mês', async () => {
    const project = await t.db
      .insertInto('projects')
      .values({ name: 'P' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const wf = await t.db
      .insertInto('workflows')
      .values({ project_id: project.id, name: 'W' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const exec = await t.db
      .insertInto('executions')
      .values({
        workflow_id: wf.id,
        project_id: project.id,
        mode: 'test',
        trigger_type: 'manual',
        status: 'running',
      })
      .returning(['id', 'started_at'])
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto('node_executions')
      .values({
        execution_id: exec.id,
        node_id: 'n1',
        node_name: 'Início',
        status: 'success',
        started_at: exec.started_at,
        output_data: JSON.stringify({ main: [{ json: { a: 1 } }] }),
      })
      .execute();
    const { rows } = await sql<{ partition: string }>`
      SELECT tableoid::regclass::text AS partition FROM executions WHERE id = ${exec.id}`.execute(
      t.db,
    );
    expect(rows[0]?.partition).toMatch(/^executions_\d{6}$/);
    const node = await t.db
      .selectFrom('node_executions')
      .selectAll()
      .where('execution_id', '=', exec.id)
      .executeTakeFirstOrThrow();
    expect(node.output_data).toEqual({ main: [{ json: { a: 1 } }] });
  });

  it('FR-014: status fora do domínio é recusado', async () => {
    await expect(
      sql`INSERT INTO executions (workflow_id, project_id, mode, trigger_type, status)
          VALUES (gen_random_uuid(), gen_random_uuid(), 'test', 'manual', 'talvez')`.execute(t.db),
    ).rejects.toThrow();
  });
});
