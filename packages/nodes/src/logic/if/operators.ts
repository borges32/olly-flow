import { DateTime } from 'luxon';

export const CONDITION_TYPES = [
  'string',
  'number',
  'boolean',
  'dateTime',
  'array',
  'object',
] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

/** Operações por tipo (plan §5), com os nomes do If v2 do N8N. */
export const OPERATIONS: Record<ConditionType, readonly string[]> = {
  string: [
    'equals',
    'notEquals',
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'regex',
    'isEmpty',
    'isNotEmpty',
  ],
  number: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty'],
  boolean: ['true', 'false', 'equals'],
  dateTime: ['equals', 'after', 'before'],
  array: ['contains', 'lengthEquals', 'isEmpty', 'isNotEmpty'],
  object: ['isEmpty', 'isNotEmpty'],
};

export const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS).flat())];

/** Operações que não usam o valor da direita. */
const UNARY = new Set(['isEmpty', 'isNotEmpty', 'true', 'false']);

export class ConditionTypeError extends Error {
  override name = 'ConditionTypeError';
}

const describe = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Valor no tipo da condição. `loose` converte; senão o tipo precisa bater (como no N8N). */
export function coerce(value: unknown, type: ConditionType, loose: boolean, side: string): unknown {
  const fail = (): never => {
    throw new ConditionTypeError(
      `tipo incorreto no valor ${side}: ${JSON.stringify(value)} é ${describe(value)}, mas a condição espera ${type}`,
    );
  };
  switch (type) {
    case 'string': {
      if (typeof value === 'string') return value;
      if (!loose) return fail();
      if (value === null || value === undefined) return '';
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
        return String(value);
      return JSON.stringify(value);
    }
    case 'number': {
      if (typeof value === 'number' && !Number.isNaN(value)) return value;
      if (!loose) return fail();
      const n =
        typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : typeof value === 'boolean'
            ? Number(value)
            : NaN;
      return Number.isNaN(n) ? fail() : n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (!loose) return fail();
      if (value === 'true' || value === 1 || value === '1') return true;
      if (value === 'false' || value === 0 || value === '0') return false;
      return fail();
    case 'dateTime': {
      // Expressões entregam datas como texto ISO; números são milissegundos (só no modo flexível).
      const dt =
        typeof value === 'string'
          ? DateTime.fromISO(value, { setZone: true })
          : loose && typeof value === 'number'
            ? DateTime.fromMillis(value)
            : null;
      return dt?.isValid ? dt : fail();
    }
    case 'array': {
      if (Array.isArray(value)) return value;
      if (loose && typeof value === 'string') {
        try {
          const parsed: unknown = JSON.parse(value);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // segue para o erro
        }
      }
      return fail();
    }
    case 'object': {
      const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
      if (isObject(value)) return value;
      if (loose && typeof value === 'string') {
        try {
          const parsed: unknown = JSON.parse(value);
          if (isObject(parsed)) return parsed;
        } catch {
          // segue para o erro
        }
      }
      return fail();
    }
  }
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (typeof v === 'number') return Number.isNaN(v);
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function toRegExp(pattern: string): RegExp {
  const literal = /^\/(.+)\/([a-z]*)$/s.exec(pattern);
  return literal ? new RegExp(literal[1] ?? '', literal[2]) : new RegExp(pattern);
}

const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export interface ConditionInput {
  left: unknown;
  right: unknown;
  type: ConditionType;
  operation: string;
  /** Converte o lado esquerdo/direito (texto digitado) ou exige o tipo (resultado de expressão). */
  looseLeft: boolean;
  looseRight: boolean;
}

export function evaluateCondition({
  left,
  right,
  type,
  operation,
  looseLeft,
  looseRight,
}: ConditionInput): boolean {
  if (!OPERATIONS[type].includes(operation)) {
    throw new ConditionTypeError(`operação "${operation}" não existe para o tipo ${type}`);
  }
  if (operation === 'isEmpty' || operation === 'isNotEmpty') {
    const empty = left === null || left === undefined || isEmpty(left);
    return operation === 'isEmpty' ? empty : !empty;
  }
  const l = coerce(left, type, looseLeft, 'da esquerda');
  let r: unknown;
  if (!UNARY.has(operation)) {
    if (type !== 'array') r = coerce(right, type, looseRight, 'da direita');
    else
      r = operation === 'lengthEquals' ? coerce(right, 'number', looseRight, 'da direita') : right;
  }

  switch (type) {
    case 'string': {
      const [a, b] = [l as string, r as string];
      switch (operation) {
        case 'equals':
          return a === b;
        case 'notEquals':
          return a !== b;
        case 'contains':
          return a.includes(b);
        case 'notContains':
          return !a.includes(b);
        case 'startsWith':
          return a.startsWith(b);
        case 'endsWith':
          return a.endsWith(b);
        case 'regex':
          return toRegExp(b).test(a);
      }
      break;
    }
    case 'number': {
      const [a, b] = [l as number, r as number];
      switch (operation) {
        case 'equals':
          return a === b;
        case 'notEquals':
          return a !== b;
        case 'gt':
          return a > b;
        case 'gte':
          return a >= b;
        case 'lt':
          return a < b;
        case 'lte':
          return a <= b;
      }
      break;
    }
    case 'boolean':
      if (operation === 'true') return l === true;
      if (operation === 'false') return l === false;
      return l === r;
    case 'dateTime': {
      const [a, b] = [(l as DateTime).toMillis(), (r as DateTime).toMillis()];
      if (operation === 'equals') return a === b;
      return operation === 'after' ? a > b : a < b;
    }
    case 'array': {
      const items = l as unknown[];
      if (operation === 'lengthEquals') return items.length === r;
      // Texto digitado ("1") também encontra o número 1 na lista.
      return items.some((it) => sameValue(it, r) || (looseRight && String(it) === String(r)));
    }
    case 'object':
      break;
  }
  throw new ConditionTypeError(`operação "${operation}" não suportada`);
}
