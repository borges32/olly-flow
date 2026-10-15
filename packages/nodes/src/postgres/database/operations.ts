import type { Item, NodeOutput } from '@olly/shared-types';
import {
  NodeParameterError,
  errorJson,
  failedItem,
  itemErrorMode,
  type ItemErrorMode,
} from '../../errors.js';
import type { NodeContext, NodeExecuteInput } from '../../types.js';
import type { ColumnCache } from '../catalog.js';
import { connectionConfig, type PoolManager } from '../pool.js';
import { DEFAULT_STATEMENT_TIMEOUT_MS } from '../query/execute.js';
import { inTransaction, quoteIdent } from '../sql.js';
import { orderByClause, whereClause, type Condition, type SortRule } from './conditions.js';

export interface PostgresDatabaseDeps {
  pools: PoolManager;
  columns: ColumnCache;
}

/** Comandos da exclusão, com os nomes do N8N (spec 022, FR-004). */
export const DELETE_COMMANDS = ['delete', 'truncate', 'drop'] as const;
export const DEFAULT_SELECT_LIMIT = 50;

type Row = Record<string, unknown>;

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const positiveInt = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Saída com a porta `error` quando o nó desvia os itens que falharam (spec 007, FR-013). */
const withErrors = (main: Item[], failed: Item[], mode: ItemErrorMode): NodeOutput =>
  mode === 'errorOutput'
    ? { main, error: failed.sort((a, b) => (a.pairedItem?.item ?? 0) - (b.pairedItem?.item ?? 0)) }
    : { main };

/** Tabela, pool e transação comuns à seleção e à exclusão (FR-006, FR-007, NFR-001). */
async function prepare(ctx: NodeContext, deps: PostgresDatabaseDeps, optionsParam?: string) {
  const credential = await ctx.getCredential();
  const pool = deps.pools.get(credential);
  const schema = text(ctx.getParam('schema', 0)) || 'public';
  const table = text(ctx.getParam('table', 0));
  if (!table) throw new NodeParameterError('table', 'informe a tabela');
  const poolKey = `${credential.id}:${credential.updatedAt}`;
  const options = (optionsParam ? (ctx.getParam(optionsParam, 0) ?? {}) : {}) as Record<
    string,
    unknown
  >;
  return {
    pool,
    poolKey,
    schema,
    table,
    target: `${quoteIdent(schema)}.${quoteIdent(table)}`,
    options,
    tx: {
      // FR-007: com a credencial em modo leitura, o banco recusa o que escreve.
      readOnly: credential.data.readOnly === true,
      statementTimeoutMs: positiveInt(options.statementTimeoutMs, DEFAULT_STATEMENT_TIMEOUT_MS),
      signal: ctx.signal,
      cancelConfig: connectionConfig(credential.data),
    },
  };
}

/** Colunas da tabela no catálogo (FR-006): nome inexistente falha antes do SQL. */
async function columnGuard(
  deps: PostgresDatabaseDeps,
  base: Awaited<ReturnType<typeof prepare>>,
): Promise<(name: string, where: string) => string> {
  const catalog = await deps.columns.columns(base.pool, base.poolKey, base.schema, base.table);
  const known = catalog.map((c) => c.name);
  return (name, where) => {
    if (!known.includes(name)) {
      throw new NodeParameterError(
        where,
        `coluna "${name}" não existe em ${base.schema}.${base.table}`,
      );
    }
    return name;
  };
}

/** Por item, com o tratamento de erro do nó (spec 004, FR-017; spec 007, FR-013). */
async function perItem(
  input: NodeExecuteInput,
  ctx: NodeContext,
  run: (i: number) => Promise<Item[]>,
): Promise<NodeOutput> {
  const mode = itemErrorMode(ctx.node.settings);
  const failed: Item[] = [];
  const out = await ctx.mapItems(
    input.items.map((_, i) => i),
    async (i): Promise<Item[]> => {
      try {
        return await run(i);
      } catch (error) {
        if (mode === 'stop' || ctx.signal.aborted) throw error;
        if (mode === 'errorOutput') {
          failed.push(failedItem(error, input.items[i]?.json ?? {}, i));
          return [];
        }
        return [{ json: errorJson(error), pairedItem: { item: i } }];
      }
    },
  );
  return withErrors(out.flat(), failed, mode);
}

/**
 * Seleção (spec 022, FR-003): `SELECT *` com condições, ordenação e limite, uma consulta por
 * item; cada linha vira um item.
 */
export async function executeSelect(
  input: NodeExecuteInput,
  ctx: NodeContext,
  deps: PostgresDatabaseDeps,
): Promise<NodeOutput> {
  if (input.items.length === 0) return { main: [] };
  const base = await prepare(ctx, deps);
  const ensureColumn = await columnGuard(deps, base);
  return perItem(input, ctx, async (i) => {
    const values: unknown[] = [];
    const param = (v: unknown) => {
      values.push(v);
      return `$${String(values.length)}`;
    };
    let sql = `SELECT * FROM ${base.target}`;
    sql += whereClause(
      list<Condition>(ctx.getParam('where', i)),
      ctx.getParam('combineConditions', i),
      ensureColumn,
      param,
    );
    sql += orderByClause(list<SortRule>(ctx.getParam('sort', i)), ensureColumn);
    if (ctx.getParam('returnAll', i) !== true) {
      sql += ` LIMIT ${param(positiveInt(ctx.getParam('limit', i), DEFAULT_SELECT_LIMIT))}`;
    }
    const result = await inTransaction(base.pool, base.tx, (client) =>
      client.query<Row>(sql, values),
    );
    return result.rows.map((json) => ({ json, pairedItem: { item: i } }));
  });
}

/**
 * Exclusão (spec 022, FR-004), como o "Delete" do N8N:
 * - `delete`: por item, `DELETE … [WHERE …] RETURNING *` (sem condições, todas as linhas);
 * - `truncate` e `drop`: uma vez por execução do nó, com `{ success, command }` por item.
 */
export async function executeDelete(
  input: NodeExecuteInput,
  ctx: NodeContext,
  deps: PostgresDatabaseDeps,
): Promise<NodeOutput> {
  if (input.items.length === 0) return { main: [] };
  const command = text(ctx.getParam('deleteCommand', 0)) || 'delete';
  if (!(DELETE_COMMANDS as readonly string[]).includes(command)) {
    throw new NodeParameterError(
      'deleteCommand',
      `comando desconhecido ${JSON.stringify(command)}`,
    );
  }
  const base = await prepare(ctx, deps, 'deleteOptions');

  if (command === 'delete') {
    const ensureColumn = await columnGuard(deps, base);
    return perItem(input, ctx, async (i) => {
      const values: unknown[] = [];
      const param = (v: unknown) => {
        values.push(v);
        return `$${String(values.length)}`;
      };
      const where = whereClause(
        list<Condition>(ctx.getParam('where', i)),
        ctx.getParam('combineConditions', i),
        ensureColumn,
        param,
      );
      const result = await inTransaction(base.pool, base.tx, (client) =>
        client.query<Row>(`DELETE FROM ${base.target}${where} RETURNING *`, values),
      );
      return result.rows.map((json) => ({ json, pairedItem: { item: i } }));
    });
  }

  const cascade = base.options.cascade === true ? ' CASCADE' : '';
  const sql =
    command === 'truncate'
      ? `TRUNCATE TABLE ${base.target}${base.options.restartSequences === true ? ' RESTART IDENTITY' : ''}${cascade}`
      : `DROP TABLE ${base.target}${cascade}`;
  // Sem valores no comando: ele vai para a saída e para o log da execução.
  await inTransaction(base.pool, base.tx, (client) => client.query(sql));
  if (command === 'drop') deps.columns.invalidate(base.poolKey, base.schema, base.table);
  return {
    main: input.items.map((_, i) => ({
      json: { success: true, command: sql },
      pairedItem: { item: i },
    })),
  };
}
