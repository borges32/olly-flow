import { isExpression } from './template.js';

export type ParamPath = (string | number)[];

export interface FoundExpression {
  path: ParamPath;
  template: string;
}

/** Todas as strings-expressão dentro dos parâmetros (em qualquer profundidade). */
export function collectExpressions(params: unknown, base: ParamPath = []): FoundExpression[] {
  if (isExpression(params)) return [{ path: base, template: params }];
  if (Array.isArray(params)) return params.flatMap((v, i) => collectExpressions(v, [...base, i]));
  if (params && typeof params === 'object') {
    return Object.entries(params).flatMap(([k, v]) => collectExpressions(v, [...base, k]));
  }
  return [];
}

/** `fields[0].value` */
export function pathToString(path: ParamPath): string {
  return path.reduce<string>(
    (acc, p) => (typeof p === 'number' ? `${acc}[${p}]` : acc ? `${acc}.${p}` : p),
    '',
  );
}

/** Cópia de `value` com as expressões substituídas pelos valores calculados. */
export function substitute(
  value: unknown,
  resolve: (path: ParamPath) => unknown,
  base: ParamPath = [],
): unknown {
  if (isExpression(value)) return resolve(base);
  if (Array.isArray(value)) return value.map((v, i) => substitute(v, resolve, [...base, i]));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substitute(v, resolve, [...base, k])]),
    );
  }
  return value;
}
