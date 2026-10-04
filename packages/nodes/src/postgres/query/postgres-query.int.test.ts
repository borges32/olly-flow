import type { Item } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listColumns, listSchemas, listTables } from '../catalog.js';
import { PoolManager } from '../pool.js';
import { testCredential } from '../../credentials/test.js';
import { createHttpGuard } from '../../shared/http-guard.js';
import { fakeContext } from '../../test-support/context.js';
import { startExternalPostgres, type ExternalPostgres } from '../../test-support/postgres.js';
import { executePostgresQuery } from './execute.js';

let pgx: ExternalPostgres;
let pools: PoolManager;

beforeAll(async () => {
  pgx = await startExternalPostgres();
  pools = new PoolManager({ max: 3 });
  await pgx.admin.query(`
    CREATE TABLE clientes (id serial PRIMARY KEY, nome text NOT NULL, idade int);
    INSERT INTO clientes (nome, idade) VALUES ('Ana', 34), ('Bruno', 16), ('Carla', 22);
    CREATE TABLE x (id int);
    CREATE SCHEMA vendas;
    CREATE TABLE vendas.pedidos (id int PRIMARY KEY, total numeric);
  `);
});
afterAll(async () => {
  await pools.closeAll();
  await pgx.stop();
});

const run = (
  params: Record<string, unknown> | Record<string, unknown>[],
  items: Item[] = [{ json: {} }],
  extra: { readOnly?: boolean; signal?: AbortSignal; onError?: 'continue' } = {},
) => {
  const ctx = fakeContext({
    params,
    credential: pgx.credential({ readOnly: extra.readOnly ?? false }, extra.readOnly ? 'ro' : 'rw'),
    ...(extra.signal && { signal: extra.signal }),
    ...(extra.onError && { node: { settings: { onError: extra.onError } } }),
  });
  return { ctx, out: executePostgresQuery({ inputs: { main: items }, items }, ctx, { pools }) };
};
const rows = async (p: Promise<{ main?: Item[] }>) => (await p).main?.map((i) => i.json) ?? [];

describe('spec 004 — FR-011/FR-012: postgres.query', () => {
  it('FR-011/HU-3.1: parâmetros posicionais; uma vez para todos os itens', async () => {
    const out = await rows(
      run({
        query: 'SELECT nome FROM clientes WHERE idade >= $1 ORDER BY id',
        queryParameters: [{ value: 18 }],
      }).out,
    );
    expect(out).toEqual([{ nome: 'Ana' }, { nome: 'Carla' }]);
  });

  it('FR-011: modo por item usa os parâmetros de cada item e liga as linhas à origem', async () => {
    const items = [{ json: { n: 'Ana' } }, { json: { n: 'Carla' } }];
    const { out } = run(
      [
        {
          query: 'SELECT idade FROM clientes WHERE nome = $1',
          mode: 'perItem',
          queryParameters: [{ value: 'Ana' }],
        },
        {
          query: 'SELECT idade FROM clientes WHERE nome = $1',
          mode: 'perItem',
          queryParameters: [{ value: 'Carla' }],
        },
      ],
      items,
    );
    const result = (await out).main ?? [];
    expect(result.map((i) => [i.json.idade, i.pairedItem])).toEqual([
      [34, { item: 0 }],
      [22, { item: 1 }],
    ]);
  });

  it("SC-004/HU-3.1: '; DROP TABLE x; -- é tratado como dado", async () => {
    const payload = "'; DROP TABLE x; --";
    const out = await rows(
      run({
        query: 'SELECT $1::text AS valor, count(*)::int AS n FROM clientes WHERE nome = $1',
        queryParameters: [{ value: payload }],
      }).out,
    );
    expect(out).toEqual([{ valor: payload, n: 0 }]);
    const { rows: tables } = await pgx.admin.query(`SELECT to_regclass('public.x') AS t`);
    expect(tables[0]).toEqual({ t: 'x' });
  });

  it('FR-012: SQL iniciado por "=" (expressão) é recusado antes de executar', async () => {
    await expect(run({ query: "={{ 'DELETE FROM clientes' }}" }).out).rejects.toThrow(
      'o SQL não aceita expressões; use parâmetros ($1, $2...)',
    );
    const { rows: count } = await pgx.admin.query('SELECT count(*)::int AS n FROM clientes');
    expect(count[0]).toEqual({ n: 3 });
  });

  it('FR-013: credencial somente leitura roda em transação somente leitura (escrita falha)', async () => {
    expect(await rows(run({ query: 'SELECT 1 AS um' }, undefined, { readOnly: true }).out)).toEqual(
      [{ um: 1 }],
    );
    await expect(
      run({ query: "INSERT INTO clientes (nome) VALUES ('Zeca')" }, undefined, { readOnly: true })
        .out,
    ).rejects.toThrow(/read-only transaction/);
    const { rows: count } = await pgx.admin.query(
      `SELECT count(*)::int AS n FROM clientes WHERE nome = 'Zeca'`,
    );
    expect(count[0]).toEqual({ n: 0 });
  });

  it('FR-011: maxRows limita as linhas e registra aviso; comando sem linhas devolve sucesso', async () => {
    const { ctx, out } = run({
      query: 'SELECT generate_series(1, 50) AS n',
      options: { maxRows: 10 },
    });
    expect(await rows(out)).toHaveLength(10);
    expect(ctx.logs.join('\n')).toContain('Resultado truncado em 10 linhas');
    expect(await rows(run({ query: 'CREATE TEMP TABLE t (a int)' }).out)).toEqual([
      { success: true },
    ]);
  });

  it('SC-006/FR-018: statement timeout cancela uma query longa', async () => {
    const started = Date.now();
    await expect(
      run({ query: 'SELECT pg_sleep(10)', options: { statementTimeoutMs: 300 } }).out,
    ).rejects.toThrow('Consulta cancelada (timeout ou cancelamento)');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('FR-018: abortar o sinal cancela a consulta no servidor', async () => {
    const controller = new AbortController();
    const pending = run({ query: 'SELECT pg_sleep(30)' }, undefined, {
      signal: controller.signal,
    }).out;
    await new Promise((r) => setTimeout(r, 300));
    controller.abort(new Error('cancelado'));
    await expect(pending).rejects.toThrow('Consulta cancelada');
    const { rows: active } = await pgx.admin.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE query = 'SELECT pg_sleep(30)' AND state = 'active'`,
    );
    expect(active[0]).toEqual({ n: 0 });
  });

  it('FR-017: onError continue no modo por item — o item com erro vira { error }', async () => {
    const out = await rows(
      run(
        [
          { query: 'SELECT 10 / $1::int AS r', mode: 'perItem', queryParameters: [{ value: 0 }] },
          { query: 'SELECT 10 / $1::int AS r', mode: 'perItem', queryParameters: [{ value: 2 }] },
        ],
        [{ json: {} }, { json: {} }],
        { onError: 'continue' },
      ).out,
    );
    expect(out[0]).toMatchObject({
      error: { message: 'division by zero', description: 'SQLSTATE 22012' },
    });
    expect(out[1]).toEqual({ r: 5 });
  });
});

describe('spec 004 — NFR-002: pools por credencial', () => {
  it('NFR-002: reaproveita o pool, respeita o máximo e troca de pool quando a credencial muda', async () => {
    const manager = new PoolManager({ max: 2 });
    const credential = pgx.credential({}, 'pool-test');
    const pool = manager.get(credential);
    expect(manager.get(credential)).toBe(pool);
    expect(pool.options.max).toBe(2);
    const updated = manager.get({ ...credential, updatedAt: '2026-10-05T00:00:00.000Z' });
    expect(updated).not.toBe(pool);
    expect(manager.size).toBe(1);
    await manager.sweep(Date.now() + 10 * 60_000);
    expect(manager.size).toBe(0);
    await manager.closeAll();
  });
});

describe('spec 004 — FR-016/FR-005: catálogo e teste de conexão', () => {
  it('FR-016: lista schemas, tabelas e colunas sem os schemas de sistema', async () => {
    const pool = pools.get(pgx.credential({}, 'catalog'));
    const schemas = await listSchemas(pool);
    expect(schemas).toEqual(expect.arrayContaining(['public', 'vendas']));
    expect(schemas).not.toContain('pg_catalog');
    expect(await listTables(pool, 'vendas')).toEqual(['pedidos']);
    expect(await listColumns(pool, 'public', 'clientes')).toEqual([
      { name: 'id', type: 'integer', nullable: false, hasDefault: true },
      { name: 'nome', type: 'text', nullable: false, hasDefault: false },
      { name: 'idade', type: 'integer', nullable: true, hasDefault: false },
    ]);
  });

  it('FR-005: teste de credencial Postgres — sucesso e senha errada', async () => {
    const guard = createHttpGuard();
    expect(await testCredential(pgx.credential(), { guard })).toEqual({
      ok: true,
      message: 'Conexão bem-sucedida',
    });
    const bad = await testCredential(pgx.credential({ password: 'senha-errada-xyz' }), { guard });
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/password authentication failed/);
    expect(bad.message).not.toContain('senha-errada-xyz');
  });
});
