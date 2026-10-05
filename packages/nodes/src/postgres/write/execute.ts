import type { Item, NodeOutput } from '@olly/shared-types';
import type pg from 'pg';
import { NodeParameterError, errorJson } from '../../errors.js';
import type { NodeContext, NodeExecuteInput } from '../../types.js';
import type { ColumnCache } from '../catalog.js';
import { connectionConfig, type PoolManager } from '../pool.js';
import { DEFAULT_STATEMENT_TIMEOUT_MS } from '../query/execute.js';
import { inTransaction, quoteIdent } from '../sql.js';

export interface PostgresWriteDeps {
  pools: PoolManager;
  columns: ColumnCache;
}

type Operation = 'insert' | 'update' | 'upsert';
type Row = Record<string, unknown>;

interface Statement {
  text: string;
  values: unknown[];
  /** Índices dos itens de entrada cobertos pelo comando. */
  items: number[];
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const positiveInt = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;

interface Plan {
  target: string;
  columns: string[];
  matching: string[];
  returning: string;
  skipOnConflict: boolean;
}

/** Monta INSERT multi-linha (com upsert opcional) para um lote; valores só como `$n` (FR-014). */
function insertStatement(plan: Plan, rows: Row[], items: number[], upsert: boolean): Statement {
  const used = plan.columns.filter((c) => rows.some((r) => c in r));
  if (used.length === 0) throw new NodeParameterError('columns', 'nenhuma coluna para gravar');
  const values: unknown[] = [];
  const tuples = rows.map(
    (row) =>
      `(${used
        .map((c) => {
          if (!(c in row)) return 'DEFAULT';
          values.push(row[c]);
          return `$${values.length}`;
        })
        .join(', ')})`,
  );
  let sql = `INSERT INTO ${plan.target} (${used.map(quoteIdent).join(', ')}) VALUES ${tuples.join(', ')}`;
  if (upsert) {
    const updates = used.filter((c) => !plan.matching.includes(c));
    const conflict = plan.matching.map(quoteIdent).join(', ');
    sql +=
      updates.length > 0
        ? ` ON CONFLICT (${conflict}) DO UPDATE SET ${updates.map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(', ')}`
        : ` ON CONFLICT (${conflict}) DO NOTHING`;
  } else if (plan.skipOnConflict) {
    sql += ' ON CONFLICT DO NOTHING';
  }
  if (plan.returning) sql += ` RETURNING ${plan.returning}`;
  return { text: sql, values, items };
}

function updateStatement(plan: Plan, row: Row, item: number): Statement {
  const sets = plan.columns.filter((c) => c in row && !plan.matching.includes(c));
  if (sets.length === 0) {
    throw new NodeParameterError('columns', `o item ${item} não tem colunas para atualizar`);
  }
  const values: unknown[] = [];
  const param = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  const setSql = sets.map((c) => `${quoteIdent(c)} = ${param(row[c])}`).join(', ');
  const whereSql = plan.matching.map((c) => `${quoteIdent(c)} = ${param(row[c])}`).join(' AND ');
  let sql = `UPDATE ${plan.target} SET ${setSql} WHERE ${whereSql}`;
  if (plan.returning) sql += ` RETURNING ${plan.returning}`;
  return { text: sql, values, items: [item] };
}

function outputFor(
  statement: Statement,
  result: pg.QueryResult<Row>,
  items: Item[],
  returning: boolean,
): Item[] {
  const [first = 0] = statement.items;
  if (!returning) {
    return statement.items.map((i) => ({ json: items[i]?.json ?? {}, pairedItem: { item: i } }));
  }
  // Linhas na ordem do VALUES quando a contagem bate; senão, ligadas ao 1º item do lote.
  const aligned = result.rows.length === statement.items.length;
  return result.rows.map((json, r) => ({
    json,
    pairedItem: { item: aligned ? (statement.items[r] ?? first) : first },
  }));
}

export async function executePostgresWrite(
  input: NodeExecuteInput,
  ctx: NodeContext,
  deps: PostgresWriteDeps,
): Promise<NodeOutput> {
  const items = input.items;
  if (items.length === 0) return { main: [] };
  const credential = await ctx.getCredential();
  const pool = deps.pools.get(credential);
  const operation = ctx.getParam('operation', 0) as Operation;
  if (!['insert', 'update', 'upsert'].includes(operation)) {
    throw new NodeParameterError('operation', `operação desconhecida ${JSON.stringify(operation)}`);
  }
  const schema = text(ctx.getParam('schema', 0)) || 'public';
  const table = text(ctx.getParam('table', 0));
  if (!table) throw new NodeParameterError('table', 'informe a tabela');

  // FR-015: schema, tabela e colunas precisam existir no catálogo.
  const catalog = await deps.columns.columns(
    pool,
    `${credential.id}:${credential.updatedAt}`,
    schema,
    table,
  );
  const known = catalog.map((c) => c.name);
  const ensureColumn = (name: string, where: string) => {
    if (!known.includes(name)) {
      throw new NodeParameterError(where, `coluna "${name}" não existe em ${schema}.${table}`);
    }
    return name;
  };

  const options = (ctx.getParam('options', 0) ?? {}) as Record<string, unknown>;
  const returningRaw = typeof options.returning === 'string' ? options.returning.trim() : '*';
  const returning =
    returningRaw === '' || returningRaw === '*'
      ? returningRaw
      : returningRaw
          .split(',')
          .map((c) => quoteIdent(ensureColumn(c.trim(), 'options.returning')))
          .join(', ');
  const matching = ((ctx.getParam('matchingColumns', 0) ?? []) as { column?: unknown }[]).map((m) =>
    ensureColumn(text(m.column), 'matchingColumns'),
  );
  if (operation !== 'insert' && matching.length === 0) {
    throw new NodeParameterError(
      'matchingColumns',
      `informe as colunas de correspondência do ${operation}`,
    );
  }

  const rowFor = (i: number): Row => {
    const mapping = (ctx.getParam('columns', i) ?? {}) as {
      mappingMode?: unknown;
      values?: unknown;
    };
    if (mapping.mappingMode === 'defineBelow') {
      const values = Array.isArray(mapping.values)
        ? (mapping.values as { column?: unknown; value?: unknown }[])
        : [];
      return Object.fromEntries(
        values.map((v) => [ensureColumn(text(v.column), 'columns.values'), v.value ?? null]),
      );
    }
    const json = items[i]?.json ?? {};
    for (const key of Object.keys(json)) {
      if (!known.includes(key)) {
        throw new NodeParameterError(
          'columns',
          `o campo "${key}" do item ${i} não corresponde a nenhuma coluna de ${schema}.${table}`,
        );
      }
    }
    return { ...json };
  };

  const plan: Plan = {
    target: `${quoteIdent(schema)}.${quoteIdent(table)}`,
    columns: known,
    matching,
    returning,
    skipOnConflict: options.skipOnConflict === true,
  };
  const continueOnFail = ctx.node.settings?.onError === 'continue';
  const allItems = options.transaction === 'allItems';
  // Sem transação e com onError continue, item a item: um item ruim não derruba o lote.
  const batchSize = continueOnFail && !allItems ? 1 : positiveInt(options.batchSize, 100);

  const build = (indices: number[]): Statement[] => {
    const rows = indices.map((i) => {
      const row = rowFor(i);
      for (const m of matching) {
        if (!(m in row))
          throw new NodeParameterError('matchingColumns', `o item ${i} não tem a coluna "${m}"`);
      }
      return row;
    });
    if (operation === 'update')
      return rows.map((row, k) => updateStatement(plan, row, indices[k] ?? 0));
    return [insertStatement(plan, rows, indices, operation === 'upsert')];
  };
  const batches: number[][] = [];
  const all = items.map((_, i) => i);
  for (
    let start = 0;
    start < all.length;
    start += operation === 'update' ? all.length : batchSize
  ) {
    batches.push(all.slice(start, start + (operation === 'update' ? all.length : batchSize)));
  }

  const tx = {
    readOnly: credential.data.readOnly === true,
    statementTimeoutMs: positiveInt(options.statementTimeoutMs, DEFAULT_STATEMENT_TIMEOUT_MS),
    signal: ctx.signal,
    cancelConfig: connectionConfig(credential.data),
  };
  const run = async (client: pg.PoolClient, statement: Statement) =>
    outputFor(
      statement,
      await client.query<Row>(statement.text, statement.values),
      items,
      returning !== '',
    );

  if (allItems) {
    // SC-005: uma transação para tudo; qualquer falha desfaz todos os itens.
    const statements = batches.flatMap(build);
    const out = await inTransaction(pool, tx, async (client) => {
      const results: Item[] = [];
      for (const s of statements) results.push(...(await run(client, s)));
      return results;
    });
    return { main: out };
  }

  // Sem transação única, cada lote (ou item, no update) é independente: pode rodar em paralelo
  // com `settings.parallelItems` (spec 006, FR-009), na ordem dos itens.
  const units = operation === 'update' ? all.map((i) => [i]) : batches;
  const out = await ctx.mapItems(units, async (unit): Promise<Item[]> => {
    try {
      const results: Item[] = [];
      for (const statement of build(unit)) {
        results.push(...(await inTransaction(pool, tx, (client) => run(client, statement))));
      }
      return results;
    } catch (error) {
      if (!continueOnFail || ctx.signal.aborted) throw error;
      return unit.map((i) => ({ json: errorJson(error), pairedItem: { item: i } }));
    }
  });
  return { main: out.flat() };
}
