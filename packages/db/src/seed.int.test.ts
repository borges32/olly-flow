import { DEFAULT_ROLE_PERMISSIONS } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedRoles } from './index.js';
import { startTestDatabase, type TestDatabase } from './testing.js';

let t: TestDatabase;

beforeAll(async () => {
  t = await startTestDatabase({ seed: false });
});
afterAll(async () => {
  await t.stop();
});

async function roles(): Promise<Record<string, string[]>> {
  const rows = await t.db.selectFrom('roles').select(['name', 'permissions']).execute();
  return Object.fromEntries(rows.map((r) => [r.name, [...r.permissions].sort()]));
}

describe('FR-010: seed dos papéis padrão', () => {
  it('FR-010: cria admin, editor, executor e viewer com as permissões da matriz', async () => {
    await seedRoles(t.db);
    const expected = Object.fromEntries(
      Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([name, perms]) => [name, [...perms].sort()]),
    );
    expect(await roles()).toEqual(expected);
    expect((await roles()).executor).toEqual([
      'execution:read',
      'workflow:execute',
      'workflow:read',
    ]);
  });

  it('FR-010: é idempotente e restaura permissões alteradas', async () => {
    await t.db.updateTable('roles').set({ permissions: [] }).where('name', '=', 'viewer').execute();
    await seedRoles(t.db);
    await seedRoles(t.db);
    const all = await roles();
    expect(Object.keys(all).sort()).toEqual(['admin', 'editor', 'executor', 'viewer']);
    expect(all.viewer).toEqual(['execution:read', 'workflow:read']);
  });
});
