import type { Item } from '@olly/shared-types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeContext } from '../../test-support/context.js';
import { startExternalPostgres, type ExternalPostgres } from '../../test-support/postgres.js';
import { ColumnCache } from '../catalog.js';
import { PoolManager } from '../pool.js';
import { executePostgresWrite } from './execute.js';

let pgx: ExternalPostgres;
let pools: PoolManager;

beforeAll(async () => {
  pgx = await startExternalPostgres();
  pools = new PoolManager({ max: 3 });
});
beforeEach(async () => {
  await pgx.admin.query(`
    DROP TABLE IF EXISTS clientes, "tabela ""estranha""";
    CREATE TABLE clientes (
      id int PRIMARY KEY,
      nome text NOT NULL,
      cidade text DEFAULT 'Recife',
      dados jsonb
    );
    CREATE TABLE "tabela ""estranha""" ("coluna ""x""" text);
  `);
});
afterAll(async () => {
  await pools.closeAll();
  await pgx.stop();
});

const run = (
  params: Record<string, unknown> | Record<string, unknown>[],
  items: Item[],
  extra: { readOnly?: boolean; onError?: 'continue' } = {},
) => {
  const ctx = fakeContext({
    params,
    credential: pgx.credential({ readOnly: extra.readOnly ?? false }, extra.readOnly ? 'ro' : 'rw'),
    ...(extra.onError && { node: { settings: { onError: extra.onError } } }),
  });
  // Cache novo por execução: as tabelas são recriadas a cada teste.
  return executePostgresWrite({ inputs: { main: items }, items }, ctx, {
    pools,
    columns: new ColumnCache(),
  });
};
const all = async () =>
  (await pgx.admin.query('SELECT id, nome, cidade, dados FROM clientes ORDER BY id'))
    .rows as Record<string, unknown>[];
const items = (...rows: Record<string, unknown>[]) => rows.map((json) => ({ json }));

describe('spec 004 — FR-014: postgres.write', () => {
  it('FR-014/HU-3.2: insert com mapeamento automático, em lotes, com RETURNING e DEFAULT', async () => {
    const out = await run(
      { operation: 'insert', table: 'clientes', options: { batchSize: 2 } },
      items(
        { id: 1, nome: 'Ana', dados: { vip: true } },
        { id: 2, nome: 'Bruno' },
        { id: 3, nome: 'Carla', cidade: 'Olinda' },
      ),
    );
    expect(out.main?.map((i) => [i.json.id, i.pairedItem])).toEqual([
      [1, { item: 0 }],
      [2, { item: 1 }],
      [3, { item: 2 }],
    ]);
    expect(await all()).toEqual([
      { id: 1, nome: 'Ana', cidade: 'Recife', dados: { vip: true } },
      { id: 2, nome: 'Bruno', cidade: 'Recife', dados: null },
      { id: 3, nome: 'Carla', cidade: 'Olinda', dados: null },
    ]);
  });

  it('FR-014: mapeamento manual de colunas e retorno de colunas escolhidas', async () => {
    const out = await run(
      [
        {
          operation: 'insert',
          table: 'clientes',
          columns: {
            mappingMode: 'defineBelow',
            values: [
              { column: 'id', value: 7 },
              { column: 'nome', value: 'Zé' },
            ],
          },
          options: { returning: 'id, nome' },
        },
      ],
      items({ ignorado: true }),
    );
    expect(out.main?.[0]?.json).toEqual({ id: 7, nome: 'Zé' });
  });

  it('FR-014: update pelas colunas de correspondência', async () => {
    await pgx.admin.query(`INSERT INTO clientes (id, nome) VALUES (1, 'Ana'), (2, 'Bruno')`);
    const out = await run(
      {
        operation: 'update',
        table: 'clientes',
        matchingColumns: [{ column: 'id' }],
        options: { returning: '' },
      },
      items({ id: 2, cidade: 'Caruaru' }),
    );
    expect(out.main).toEqual([{ json: { id: 2, cidade: 'Caruaru' }, pairedItem: { item: 0 } }]);
    expect((await all()).map((r) => r.cidade)).toEqual(['Recife', 'Caruaru']);
  });

  it('FR-014: upsert insere os novos e atualiza os existentes (ON CONFLICT)', async () => {
    await pgx.admin.query(`INSERT INTO clientes (id, nome) VALUES (1, 'Ana')`);
    await run(
      { operation: 'upsert', table: 'clientes', matchingColumns: [{ column: 'id' }] },
      items({ id: 1, nome: 'Ana Maria' }, { id: 2, nome: 'Bruno' }),
    );
    expect((await all()).map((r) => r.nome)).toEqual(['Ana Maria', 'Bruno']);
  });

  it('FR-014: skipOnConflict ignora linhas em conflito no insert', async () => {
    await pgx.admin.query(`INSERT INTO clientes (id, nome) VALUES (1, 'Ana')`);
    await run(
      { operation: 'insert', table: 'clientes', options: { skipOnConflict: true } },
      items({ id: 1, nome: 'Outra' }, { id: 2, nome: 'Bruno' }),
    );
    expect((await all()).map((r) => r.nome)).toEqual(['Ana', 'Bruno']);
  });

  it('SC-005/HU-3.3: transaction allItems faz rollback completo se um item falha', async () => {
    await expect(
      run(
        {
          operation: 'insert',
          table: 'clientes',
          options: { transaction: 'allItems', batchSize: 1 },
        },
        items({ id: 1, nome: 'Ana' }, { id: 2, nome: 'Bruno' }, { id: 3 }),
      ),
    ).rejects.toThrow(/null value in column "nome"/);
    expect(await all()).toEqual([]);
  });

  it('FR-014/FR-017: sem transação e com onError continue, só o item ruim falha', async () => {
    const out = await run(
      { operation: 'insert', table: 'clientes' },
      items({ id: 1, nome: 'Ana' }, { id: 2 }, { id: 3, nome: 'Carla' }),
      { onError: 'continue' },
    );
    expect(out.main?.[1]?.json).toMatchObject({
      error: { message: expect.stringMatching(/null value/) as string },
    });
    expect((await all()).map((r) => r.id)).toEqual([1, 3]);
  });

  it("SC-004: valores com '; DROP TABLE são gravados como dado", async () => {
    await run(
      { operation: 'insert', table: 'clientes' },
      items({ id: 1, nome: "'; DROP TABLE clientes; --" }),
    );
    expect((await all())[0]?.nome).toBe("'; DROP TABLE clientes; --");
  });
});

describe('spec 004 — FR-015: identificadores validados e escapados', () => {
  it('FR-015: tabela, coluna mapeada, coluna de correspondência ou de retorno inexistentes são recusadas', async () => {
    await expect(
      run({ operation: 'insert', table: 'nao_existe' }, items({ a: 1 })),
    ).rejects.toThrow('tabela "public.nao_existe" não existe');
    await expect(
      run({ operation: 'insert', table: 'clientes' }, items({ id: 1, 'nome; DROP': 'x' })),
    ).rejects.toThrow(
      'o campo "nome; DROP" do item 0 não corresponde a nenhuma coluna de public.clientes',
    );
    await expect(
      run(
        { operation: 'update', table: 'clientes', matchingColumns: [{ column: 'id) OR (1=1' }] },
        items({ id: 1 }),
      ),
    ).rejects.toThrow('coluna "id) OR (1=1" não existe');
    await expect(
      run(
        { operation: 'insert', table: 'clientes', options: { returning: 'id, pg_sleep(1)' } },
        items({ id: 1, nome: 'a' }),
      ),
    ).rejects.toThrow('coluna "pg_sleep(1)" não existe');
    await expect(run({ operation: 'update', table: 'clientes' }, items({ id: 1 }))).rejects.toThrow(
      'informe as colunas de correspondência do update',
    );
  });

  it('FR-015: nomes com aspas são escapados corretamente', async () => {
    await run({ operation: 'insert', table: 'tabela "estranha"' }, items({ 'coluna "x"': 'ok' }));
    const { rows } = await pgx.admin.query('SELECT * FROM "tabela ""estranha"""');
    expect(rows).toEqual([{ 'coluna "x"': 'ok' }]);
  });

  it('caso de borda: credencial somente leitura em comando de escrita falha', async () => {
    await expect(
      run({ operation: 'insert', table: 'clientes' }, items({ id: 1, nome: 'Ana' }), {
        readOnly: true,
      }),
    ).rejects.toThrow(/read-only transaction/);
    expect(await all()).toEqual([]);
  });
});
