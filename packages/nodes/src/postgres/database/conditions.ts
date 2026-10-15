import { NodeParameterError } from '../../errors.js';
import { quoteIdent } from '../sql.js';

/** Operadores das condições, com os nomes do N8N (spec 022, FR-005). */
export const CONDITION_OPERATORS = [
  'equal',
  '!=',
  'LIKE',
  '>',
  '<',
  '>=',
  '<=',
  'IS NULL',
  'IS NOT NULL',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

const SQL_OPERATORS: Record<ConditionOperator, string> = {
  equal: '=',
  '!=': '<>',
  LIKE: 'LIKE',
  '>': '>',
  '<': '<',
  '>=': '>=',
  '<=': '<=',
  'IS NULL': 'IS NULL',
  'IS NOT NULL': 'IS NOT NULL',
};

export interface Condition {
  column?: unknown;
  condition?: unknown;
  value?: unknown;
}

export interface SortRule {
  column?: unknown;
  direction?: unknown;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * `WHERE` das condições (FR-005, FR-006): colunas conferidas por `ensureColumn` e entre aspas;
 * valores só como parâmetros (`param` devolve `$n`). Sem condições, vazio.
 */
export function whereClause(
  conditions: Condition[],
  combine: unknown,
  ensureColumn: (name: string, where: string) => string,
  param: (value: unknown) => string,
): string {
  if (conditions.length === 0) return '';
  const joiner = combine === 'OR' ? ' OR ' : ' AND ';
  const parts = conditions.map((c, i) => {
    const column = quoteIdent(ensureColumn(text(c.column), `where[${String(i)}].column`));
    const operator = (text(c.condition) || 'equal') as ConditionOperator;
    if (!(operator in SQL_OPERATORS)) {
      throw new NodeParameterError(
        `where[${String(i)}].condition`,
        `operador desconhecido ${JSON.stringify(operator)}`,
      );
    }
    const sql = SQL_OPERATORS[operator];
    if (operator === 'IS NULL' || operator === 'IS NOT NULL') return `${column} ${sql}`;
    return `${column} ${sql} ${param(c.value ?? null)}`;
  });
  return ` WHERE ${parts.join(joiner)}`;
}

/** `ORDER BY` da seleção (FR-003), com colunas conferidas. */
export function orderByClause(
  rules: SortRule[],
  ensureColumn: (name: string, where: string) => string,
): string {
  if (rules.length === 0) return '';
  const parts = rules.map((r, i) => {
    const column = quoteIdent(ensureColumn(text(r.column), `sort[${String(i)}].column`));
    return `${column} ${r.direction === 'DESC' ? 'DESC' : 'ASC'}`;
  });
  return ` ORDER BY ${parts.join(', ')}`;
}
