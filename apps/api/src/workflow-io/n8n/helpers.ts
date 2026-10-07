/** Utilidades dos conversores do N8N (spec 015, plan §4). */

export type Params = Record<string, unknown>;

export const isObject = (v: unknown): v is Params =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : fallback;

export const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** `{ campo: { valores: [...] } }` do N8N (coleções fixas): a lista interna. */
export const collection = (v: unknown, key: string): Params[] =>
  isObject(v) ? list(v[key]).filter(isObject) : [];

/** Resource locator do N8N (`{ __rl: true, value, mode }`) ou valor simples. */
export function rl(v: unknown): string {
  if (isObject(v)) return str(v.value);
  return str(v);
}

/** Versão do tipo: as listadas (ou a faixa `[min, max]`). */
export const versionIn = (v: number, min: number, max: number) => v >= min && v <= max;

const SINGLE = /^\s*\{\{([\s\S]*)\}\}\s*$/;

/**
 * Valor de parâmetro do N8N como código JavaScript: expressão de um trecho vira o próprio código;
 * template misto vira template string; literal vira JSON. Usado para montar um objeto JSON a
 * partir de pares nome/valor (corpo "keypair" do HTTP).
 */
export function toJsExpression(value: unknown): string {
  if (typeof value !== 'string') return JSON.stringify(value ?? null);
  if (!value.startsWith('=')) return JSON.stringify(value);
  const template = value.slice(1);
  const single = SINGLE.exec(template);
  if (single && !single[1]?.includes('}}')) return `(${single[1]?.trim() ?? ''})`;
  const parts: string[] = [];
  let rest = template;
  for (;;) {
    const start = rest.indexOf('{{');
    if (start < 0) break;
    const end = rest.indexOf('}}', start + 2);
    if (end < 0) break;
    parts.push(escapeTemplate(rest.slice(0, start)), '${', rest.slice(start + 2, end).trim(), '}');
    rest = rest.slice(end + 2);
  }
  parts.push(escapeTemplate(rest));
  return '`' + parts.join('') + '`';
}

const escapeTemplate = (s: string) => s.replace(/[`\\]/g, (c) => `\\${c}`).replace(/\$\{/g, '\\${');

/** Pares `{ name, value }` como expressão que produz um objeto. */
export function pairsToObjectExpression(pairs: { name: string; value: unknown }[]): string {
  const body = pairs.map((p) => `${JSON.stringify(p.name)}: ${toJsExpression(p.value)}`).join(', ');
  return `={{ ({ ${body} }) }}`;
}

/** Texto JSON de um objeto simples (sem expressão) em pares nome/valor; senão `undefined`. */
export function jsonObjectToPairs(text: unknown): { name: string; value: string }[] | undefined {
  if (typeof text !== 'string' || text.startsWith('=')) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isObject(parsed)) return undefined;
    return Object.entries(parsed).map(([name, v]) => ({
      name,
      value: typeof v === 'string' ? v : JSON.stringify(v),
    }));
  } catch {
    return undefined;
  }
}
