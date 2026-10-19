import type { Item } from '@olly/shared-types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeContext } from '../../test-support/context.js';
import { startExternalPostgres, type ExternalPostgres } from '../../test-support/postgres.js';
import { ColumnCache } from '../catalog.js';
import { PoolManager } from '../pool.js';
import { createPostgresDatabaseNode } from './definition.js';

/**
 * Spec 022 (T012): nó PostgreSQL único com um PostgreSQL real: executar consulta e gravar pelo
 * nó único (spec 004), selecionar, excluir, esvaziar e remover, credencial somente leitura e
 * "continuar" por item.
 */
let pgx: ExternalPostgres;
let pools: PoolManager;
let columns: ColumnCache;

beforeAll(async () => {
  pgx = await startExternalPostgres();
  pools = new PoolManager({ max: 3 });
});
beforeEach(async () => {
  columns = new ColumnCache();
  await pgx.admin.query(`
    DROP TABLE IF EXISTS pedidos, clientes CASCADE;
    CREATE TABLE clientes (
      id serial PRIMARY KEY,
      nome text NOT NULL,
      cidade text,
      idade int
    );
    INSERT INTO clientes (nome, cidade, idade) VALUES
      ('Ana', 'Recife', 34),
      ('Bruno', 'Olinda', 16),
      ('Carla', 'Recife', 51),
      ('Davi', NULL, 22);
    CREATE TABLE pedidos (id int PRIMARY KEY, cliente int REFERENCES clientes(id));
    INSERT INTO pedidos VALUES (1, 1);
  `);
});
afterAll(async () => {
  await pools.closeAll();
  await pgx.stop();
});

const run = (
  params: Record<string, unknown> | Record<string, unknown>[],
  items: Item[] = [{ json: {} }],
  extra: { readOnly?: boolean; onError?: 'continue' } = {},
) => {
  const ctx = fakeContext({
    params,
    credential: pgx.credential({ readOnly: extra.readOnly ?? false }, extra.readOnly ? 'ro' : 'rw'),
    ...(extra.onError && { node: { settings: { onError: extra.onError } } }),
  });
  const node = createPostgresDatabaseNode({ pools, columns });
  return node.execute({ inputs: { main: items }, items }, ctx);
};
const names = async () =>
  (await pgx.admin.query('SELECT nome FROM clientes ORDER BY id')).rows.map(
    (r: { nome: string }) => r.nome,
  );

describe('spec 022 — nó PostgreSQL único', () => {
  it('FR-001/FR-002: executar consulta e gravar pelo nó único, com as opções por operação', async () => {
    const queried = await run({
      operation: 'executeQuery',
      query: 'SELECT nome FROM clientes WHERE idade > $1 ORDER BY id',
      queryParameters: [{ value: 30 }],
      queryOptions: { maxRows: 1 },
    });
    // maxRows de `queryOptions` vale (como o `options` do postgres.query).
    expect(queried.main?.map((i) => i.json)).toEqual([{ nome: 'Ana' }]);

    const written = await run(
      {
        operation: 'update',
        table: 'clientes',
        matchingColumns: [{ column: 'id' }],
        writeOptions: { returning: 'nome' },
      },
      [{ json: { id: 2, nome: 'Bruna' } }],
    );
    expect(written.main?.map((i) => i.json)).toEqual([{ nome: 'Bruna' }]);
    expect(await names()).toEqual(['Ana', 'Bruna', 'Carla', 'Davi']);
  });

  it('SC-002/FR-003/FR-005: selecionar com condições, ordenação e limite; cada linha vira um item', async () => {
    const out = await run({
      operation: 'select',
      table: 'clientes',
      where: [
        { column: 'cidade', condition: 'equal', value: 'Recife' },
        { column: 'idade', condition: '>=', value: 18 },
      ],
      sort: [{ column: 'idade', direction: 'DESC' }],
      limit: 1,
    });
    expect(out.main?.map((i) => [i.json.nome, i.pairedItem])).toEqual([['Carla', { item: 0 }]]);

    const nulls = await run({
      operation: 'select',
      table: 'clientes',
      where: [
        { column: 'cidade', condition: 'IS NULL' },
        { column: 'nome', condition: 'LIKE', value: 'B%' },
      ],
      combineConditions: 'OR',
      returnAll: true,
      sort: [{ column: 'nome' }],
    });
    expect(nulls.main?.map((i) => i.json.nome)).toEqual(['Bruno', 'Davi']);
  });

  it('FR-003: uma consulta por item de entrada, com o valor da condição de cada item', async () => {
    const out = await run(
      [
        { operation: 'select', table: 'clientes', where: [{ column: 'id', value: 1 }] },
        { operation: 'select', table: 'clientes', where: [{ column: 'id', value: 3 }] },
      ],
      [{ json: { id: 1 } }, { json: { id: 3 } }],
    );
    expect(out.main?.map((i) => [i.json.nome, i.pairedItem?.item])).toEqual([
      ['Ana', 0],
      ['Carla', 1],
    ]);
  });

  it('SC-001/FR-004: excluir linhas por condição devolve as excluídas; sem condições, todas', async () => {
    const deleted = await run({
      operation: 'deleteTable',
      deleteCommand: 'delete',
      table: 'clientes',
      where: [{ column: 'idade', condition: '<', value: 18 }],
    });
    expect(deleted.main?.map((i) => i.json.nome)).toEqual(['Bruno']);
    expect(await names()).toEqual(['Ana', 'Carla', 'Davi']);

    await pgx.admin.query('DELETE FROM pedidos');
    const all = await run({ operation: 'deleteTable', deleteCommand: 'delete', table: 'clientes' });
    expect(all.main).toHaveLength(3);
    expect(await names()).toEqual([]);
  });

  it('FR-004 (correção 19/10/2026): sem linhas no resultado, emite { success: true } como o N8N e o fluxo segue', async () => {
    const success = [{ json: { success: true }, pairedItem: { item: 0 } }];
    // Excluir sem linhas atingidas (o caso do "Deleta memoria").
    expect(
      await run({
        operation: 'deleteTable',
        deleteCommand: 'delete',
        table: 'clientes',
        where: [{ column: 'nome', condition: 'equal', value: 'Ninguém' }],
      }),
    ).toEqual({ main: success });
    // SQL sem RETURNING.
    expect(
      await run({
        operation: 'executeQuery',
        query: "UPDATE clientes SET cidade = 'Recife' WHERE nome = 'Ninguém'",
      }),
    ).toEqual({ main: success });
    // Selecionar sem linhas.
    expect(
      await run({
        operation: 'select',
        table: 'clientes',
        where: [{ column: 'idade', condition: '>', value: 200 }],
      }),
    ).toEqual({ main: success });
    // Por item: só o item sem linhas ganha o sucesso, na posição dele.
    const del = (nome: string) => ({
      operation: 'deleteTable',
      deleteCommand: 'delete',
      table: 'clientes',
      where: [{ column: 'nome', condition: 'equal', value: nome }],
    });
    const perItem = await run(
      [del('Ninguém'), del('Davi')],
      [{ json: { nome: 'Ninguém' } }, { json: { nome: 'Davi' } }],
    );
    expect(perItem.main?.map((i) => [i.json.success ?? i.json.nome, i.pairedItem])).toEqual([
      [true, { item: 0 }],
      ['Davi', { item: 1 }],
    ]);
  });

  it('SC-001/FR-004: esvaziar com reinício das sequências e cascata; remover a tabela', async () => {
    const truncated = await run(
      {
        operation: 'deleteTable',
        deleteCommand: 'truncate',
        table: 'clientes',
        deleteOptions: { restartSequences: true, cascade: true },
      },
      [{ json: {} }, { json: {} }],
    );
    // Uma vez por execução do nó; um item de sucesso por item de entrada.
    expect(truncated.main?.map((i) => i.json)).toEqual([
      { success: true, command: 'TRUNCATE TABLE "public"."clientes" RESTART IDENTITY CASCADE' },
      { success: true, command: 'TRUNCATE TABLE "public"."clientes" RESTART IDENTITY CASCADE' },
    ]);
    expect(await names()).toEqual([]);
    const pedidos = await pgx.admin.query('SELECT count(*)::int AS n FROM pedidos');
    expect(pedidos.rows[0]).toEqual({ n: 0 });
    await pgx.admin.query("INSERT INTO clientes (nome) VALUES ('Nova')");
    const id = await pgx.admin.query('SELECT id FROM clientes');
    expect(id.rows[0]).toEqual({ id: 1 });

    const dropped = await run({
      operation: 'deleteTable',
      deleteCommand: 'drop',
      table: 'pedidos',
    });
    expect(dropped.main?.[0]?.json).toEqual({
      success: true,
      command: 'DROP TABLE "public"."pedidos"',
    });
    const exists = await pgx.admin.query("SELECT to_regclass('public.pedidos') AS t");
    expect(exists.rows[0]).toEqual({ t: null });
  });

  it('FR-007: com a credencial somente leitura, excluir é recusado pelo banco; selecionar funciona', async () => {
    await expect(
      run(
        { operation: 'deleteTable', deleteCommand: 'delete', table: 'clientes' },
        [{ json: {} }],
        { readOnly: true },
      ),
    ).rejects.toThrow(/read-only|somente leitura/i);
    expect(await names()).toEqual(['Ana', 'Bruno', 'Carla', 'Davi']);
    const selected = await run(
      { operation: 'select', table: 'clientes', returnAll: true },
      [{ json: {} }],
      { readOnly: true },
    );
    expect(selected.main).toHaveLength(4);
  });

  it('FR-006: coluna inexistente falha antes do SQL; com "continuar", o item vira item de erro', async () => {
    await expect(
      run({ operation: 'select', table: 'clientes', where: [{ column: 'senha', value: 'x' }] }),
    ).rejects.toThrow('coluna "senha" não existe em public.clientes');
    const out = await run(
      [
        { operation: 'select', table: 'clientes', where: [{ column: 'id', value: 1 }] },
        {
          operation: 'select',
          table: 'clientes',
          where: [{ column: 'id', value: 'não é número' }],
        },
      ],
      [{ json: {} }, { json: {} }],
      { onError: 'continue' },
    );
    expect(out.main?.[0]?.json.nome).toBe('Ana');
    expect(out.main?.[1]?.json).toHaveProperty('error');
  });
});
