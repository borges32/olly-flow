import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './testing.js';

let t: TestDatabase;
let id: string;

beforeAll(async () => {
  t = await startTestDatabase();
  const row = await t.db
    .insertInto('audit_log')
    .values({
      action: 'project.create',
      entity_type: 'project',
      entity_id: 'p1',
      details: JSON.stringify({ name: 'Projeto' }),
      ip: '10.0.0.1',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  id = row.id;
});
afterAll(async () => {
  await t.stop();
});

describe('FR-011: log de auditoria imutável', () => {
  it('FR-011: permite inserir registros', async () => {
    const row = await t.db
      .selectFrom('audit_log')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.action).toBe('project.create');
    expect(row.details).toEqual({ name: 'Projeto' });
  });

  it('FR-011: UPDATE falha', async () => {
    await expect(
      t.db.updateTable('audit_log').set({ action: 'adulterado' }).where('id', '=', id).execute(),
    ).rejects.toThrow(/append-only: UPDATE/);
  });

  it('FR-011: DELETE falha', async () => {
    await expect(t.db.deleteFrom('audit_log').where('id', '=', id).execute()).rejects.toThrow(
      /append-only: DELETE/,
    );
  });

  it('FR-011: TRUNCATE falha', async () => {
    await expect(sql`TRUNCATE audit_log`.execute(t.db)).rejects.toThrow(/append-only: TRUNCATE/);
  });

  it('FR-011: o registro permanece inalterado', async () => {
    const rows = await t.db.selectFrom('audit_log').select(['id', 'action']).execute();
    expect(rows).toEqual([{ id, action: 'project.create' }]);
  });
});
