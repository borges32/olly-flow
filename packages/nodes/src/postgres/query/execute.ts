import type { Item, NodeOutput } from '@olly/shared-types';
import { NodeParameterError, errorJson } from '../../errors.js';
import type { NodeContext, NodeExecuteInput } from '../../types.js';
import { connectionConfig, type PoolManager } from '../pool.js';
import { inTransaction, queryWithLimit } from '../sql.js';

export const DEFAULT_MAX_ROWS = 1000;
export const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

export interface PostgresDeps {
  pools: PoolManager;
}

const positiveInt = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;

/** FR-012: o texto SQL nunca é expressão; valores só como parâmetros. */
export function assertStaticSql(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '')
    throw new NodeParameterError('query', 'informe o SQL');
  if (raw.startsWith('=')) {
    throw new NodeParameterError(
      'query',
      'o SQL não aceita expressões; use parâmetros ($1, $2...)',
    );
  }
  return raw;
}

function parameters(ctx: NodeContext, i: number): unknown[] {
  const raw = ctx.getParam('queryParameters', i);
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new NodeParameterError('queryParameters', 'deve ser uma lista');
  return raw.map((p) => (p as { value?: unknown }).value ?? null);
}

export async function executePostgresQuery(
  input: NodeExecuteInput,
  ctx: NodeContext,
  deps: PostgresDeps,
): Promise<NodeOutput> {
  // Lido do parâmetro bruto, antes de qualquer avaliação de expressão.
  const sql = assertStaticSql(ctx.node.params.query);
  const credential = await ctx.getCredential();
  const pool = deps.pools.get(credential);
  const options = (ctx.getParam('options', 0) ?? {}) as {
    maxRows?: unknown;
    statementTimeoutMs?: unknown;
  };
  const maxRows = positiveInt(options.maxRows, DEFAULT_MAX_ROWS);
  const tx = {
    readOnly: credential.data.readOnly === true,
    statementTimeoutMs: positiveInt(options.statementTimeoutMs, DEFAULT_STATEMENT_TIMEOUT_MS),
    signal: ctx.signal,
    cancelConfig: connectionConfig(credential.data),
  };
  const perItem = ctx.getParam('mode', 0) === 'perItem';
  const runs = perItem ? Math.max(1, input.items.length) : 1;
  const continueOnFail = ctx.node.settings?.onError === 'continue';

  const out: Item[] = [];
  for (let i = 0; i < runs; i++) {
    try {
      const { rows, truncated } = await inTransaction(pool, tx, (client) =>
        queryWithLimit(client, sql, parameters(ctx, i), maxRows),
      );
      if (truncated) {
        ctx.logger.warn(`Resultado truncado em ${maxRows} linhas (options.maxRows)`, { item: i });
      }
      // Comando sem linhas (ex.: INSERT sem RETURNING): um item de sucesso, como no N8N.
      const json = rows.length > 0 ? rows : [{ success: true }];
      for (const row of json) out.push({ json: row, pairedItem: { item: i } });
    } catch (error) {
      if (!continueOnFail || ctx.signal.aborted) throw error;
      out.push({ json: errorJson(error), pairedItem: { item: i } });
    }
  }
  return { main: out };
}
