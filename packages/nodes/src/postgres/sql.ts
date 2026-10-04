import pg from 'pg';
import Cursor from 'pg-cursor';
import { NodeExecutionError } from '../errors.js';

/** Identificador entre aspas (já validado contra o catálogo, FR-015). */
export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

export interface TransactionOptions {
  readOnly: boolean;
  statementTimeoutMs: number;
  signal: AbortSignal;
  /** Conexão avulsa para cancelar a consulta (o pool pode estar todo ocupado). */
  cancelConfig: pg.ClientConfig;
}

async function cancelBackend(config: pg.ClientConfig, pid: number): Promise<void> {
  const client = new pg.Client(config);
  try {
    await client.connect();
    await client.query('SELECT pg_cancel_backend($1)', [pid]);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Mensagem do Postgres sem os parâmetros (que podem carregar dados do usuário). */
function toNodeError(error: unknown): Error {
  if (error instanceof NodeExecutionError) return error;
  const e = error as { message?: string; code?: string; detail?: string };
  if (e.code === '57014')
    return new NodeExecutionError('Consulta cancelada (timeout ou cancelamento)');
  if (typeof e.code === 'string') {
    return new NodeExecutionError(e.message ?? 'Erro no PostgreSQL', {
      description: `SQLSTATE ${e.code}${e.detail ? `: ${e.detail}` : ''}`,
    });
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Roda `fn` numa transação (somente leitura se a credencial for, FR-013) com
 * `statement_timeout` local. Abortar o sinal cancela a consulta no servidor (FR-018).
 */
export async function inTransaction<T>(
  pool: pg.Pool,
  options: TransactionOptions,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  options.signal.throwIfAborted();
  const client = await pool.connect();
  const pid = (client as unknown as { processID: number }).processID;
  const onAbort = () => {
    void cancelBackend(options.cancelConfig, pid).catch(() => undefined);
  };
  options.signal.addEventListener('abort', onAbort);
  let broken = false;
  try {
    await client.query(options.readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      String(options.statementTimeoutMs),
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {
      broken = true;
    });
    throw toNodeError(error);
  } finally {
    options.signal.removeEventListener('abort', onAbort);
    client.release(broken);
  }
}

/** Executa com cursor, lendo no máximo `maxRows + 1` linhas para detectar truncamento. */
export async function queryWithLimit(
  client: pg.PoolClient,
  text: string,
  values: unknown[],
  maxRows: number,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const cursor = client.query(new Cursor<Record<string, unknown>>(text, values));
  try {
    const rows = await cursor.read(maxRows + 1);
    return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
  } finally {
    await cursor.close();
  }
}
