import type pg from 'pg';
import { NodeParameterError } from '../errors.js';

const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast'];

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  hasDefault: boolean;
}

/** Schemas do banco da credencial (FR-016). */
export async function listSchemas(pool: pg.Pool): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT schema_name AS name FROM information_schema.schemata
     WHERE schema_name <> ALL($1) AND schema_name NOT LIKE 'pg_temp_%' AND schema_name NOT LIKE 'pg_toast_temp_%'
     ORDER BY schema_name`,
    [SYSTEM_SCHEMAS],
  );
  return rows.map((r) => r.name);
}

export async function listTables(pool: pg.Pool, schema: string): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type IN ('BASE TABLE', 'VIEW', 'FOREIGN')
     ORDER BY table_name`,
    [schema],
  );
  return rows.map((r) => r.name);
}

export async function listColumns(
  pool: pg.Pool,
  schema: string,
  table: string,
): Promise<ColumnInfo[]> {
  const { rows } = await pool.query<{
    name: string;
    type: string;
    nullable: string;
    column_default: string | null;
  }>(
    `SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table],
  );
  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    nullable: r.nullable === 'YES',
    hasDefault: r.column_default !== null,
  }));
}

const CACHE_MS = 60_000;

/** Colunas por tabela com cache de 60 s, para validar identificadores (FR-015, plan §7). */
export class ColumnCache {
  private readonly entries = new Map<string, { columns: ColumnInfo[]; at: number }>();

  async columns(
    pool: pg.Pool,
    poolKey: string,
    schema: string,
    table: string,
  ): Promise<ColumnInfo[]> {
    const key = `${poolKey}|${schema}|${table}`;
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.columns;
    const columns = await listColumns(pool, schema, table);
    if (columns.length === 0) {
      throw new NodeParameterError(
        'table',
        `tabela "${schema}.${table}" não existe ou não tem colunas visíveis`,
      );
    }
    this.entries.set(key, { columns, at: Date.now() });
    return columns;
  }
}
