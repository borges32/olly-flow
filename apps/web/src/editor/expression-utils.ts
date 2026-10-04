import type { Item } from '@olly/shared-types';

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

export interface SchemaField {
  key: string;
  path: (string | number)[];
  type: FieldType;
  children?: SchemaField[];
}

const typeOf = (v: unknown): FieldType =>
  v === null || v === undefined ? 'null' : Array.isArray(v) ? 'array' : (typeof v as FieldType);

function merge(values: unknown[], path: (string | number)[], depth: number): SchemaField[] {
  const keys: string[] = [];
  const samples = new Map<string, unknown[]>();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const [key, v] of Object.entries(value)) {
      if (!samples.has(key)) {
        keys.push(key);
        samples.set(key, []);
      }
      samples.get(key)?.push(v);
    }
  }
  return keys.map((key) => {
    const vs = samples.get(key) ?? [];
    const first = vs.find((v) => v !== null && v !== undefined);
    const field: SchemaField = { key, path: [...path, key], type: typeOf(first) };
    if (field.type === 'object' && depth < 6) field.children = merge(vs, field.path, depth + 1);
    return field;
  });
}

/** Schema dos itens (FR-017, visão Schema e autocomplete), a partir de uma amostra. */
export function inferSchema(items: Item[], sample = 20): SchemaField[] {
  return merge(
    items.slice(0, sample).map((i) => i.json),
    [],
    0,
  );
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `cliente.nome`, `['nome completo']`, `[0]`. */
export function accessor(path: (string | number)[]): string {
  return path
    .map((p) =>
      typeof p === 'number' ? `[${p}]` : IDENTIFIER.test(p) ? `.${p}` : `[${JSON.stringify(p)}]`,
    )
    .join('');
}

/**
 * Expressão gerada ao arrastar um campo (FR-018, plan §8): `$json…` para a entrada do próprio
 * nó, `$('Nó').item.json…` para a saída de um nó anterior.
 */
export function fieldExpression(
  path: (string | number)[],
  source: { kind: 'input' } | { kind: 'node'; name: string },
): string {
  const tail = accessor(path);
  if (source.kind === 'input') return `$json${tail}`;
  const quoted = `'${source.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return `$(${quoted}).item.json${tail}`;
}

/**
 * Insere `{{ expr }}` no parâmetro: valor fixo vira expressão; em expressão, insere na posição
 * do cursor (ou no fim).
 */
export function insertExpression(
  current: unknown,
  expr: string,
  caret?: number,
): { value: string; caret: number } {
  const snippet = `{{ ${expr} }}`;
  if (typeof current !== 'string' || !current.startsWith('=')) {
    return { value: `=${snippet}`, caret: snippet.length + 1 };
  }
  const at = caret === undefined ? current.length : Math.max(1, Math.min(caret, current.length));
  return { value: current.slice(0, at) + snippet + current.slice(at), caret: at + snippet.length };
}

export interface Suggestion {
  label: string;
  insert: string;
  detail?: string;
}

export interface SuggestionContext {
  input: SchemaField[];
  nodes: Record<string, SchemaField[]>;
}

const VARIABLES: Suggestion[] = [
  { label: '$json', insert: '$json', detail: 'Campos do item atual' },
  { label: '$input', insert: '$input', detail: 'Itens de entrada: all(), first(), last(), item' },
  { label: "$('Nó')", insert: "$('", detail: 'Dados de um nó anterior' },
  { label: '$vars', insert: '$vars', detail: 'Variáveis da execução' },
  { label: '$env', insert: '$env', detail: 'Variáveis OLLY_EXPOSED_*' },
  { label: '$execution', insert: '$execution', detail: 'id e modo da execução' },
  { label: '$workflow', insert: '$workflow', detail: 'id e nome do workflow' },
  { label: '$itemIndex', insert: '$itemIndex', detail: 'Índice do item' },
  { label: '$now', insert: '$now', detail: 'Data e hora atuais (Luxon)' },
  { label: '$today', insert: '$today', detail: 'Hoje à meia-noite (Luxon)' },
];

function descend(fields: SchemaField[], segments: string[]): SchemaField[] | undefined {
  let current: SchemaField[] | undefined = fields;
  for (const segment of segments) current = current?.find((f) => f.key === segment)?.children;
  return current;
}

const fieldSuggestions = (fields: SchemaField[] | undefined, partial: string): Suggestion[] =>
  (fields ?? [])
    .filter((f) => f.key.startsWith(partial) && IDENTIFIER.test(f.key))
    .map((f) => ({ label: f.key, insert: f.key, detail: f.type }));

/**
 * Sugestões de autocomplete (FR-018) para o texto antes do cursor. Só dentro de um `{{` aberto.
 * `from` é a posição a partir da qual o texto digitado é substituído.
 */
export function suggest(
  beforeCaret: string,
  ctx: SuggestionContext,
): { from: number; items: Suggestion[] } | null {
  const open = beforeCaret.lastIndexOf('{{');
  if (open === -1 || beforeCaret.lastIndexOf('}}') > open) return null;
  const code = beforeCaret.slice(open + 2);

  const nodeField = /\$\(\s*'([^']+)'\s*\)\.item\.json((?:\.[\w$]+)*)\.([\w$]*)$/.exec(code);
  if (nodeField) {
    const [, name = '', chain = '', partial = ''] = nodeField;
    const items = fieldSuggestions(
      descend(ctx.nodes[name] ?? [], chain.split('.').filter(Boolean)),
      partial,
    );
    return items.length ? { from: beforeCaret.length - partial.length, items } : null;
  }
  const json = /\$json((?:\.[\w$]+)*)\.([\w$]*)$/.exec(code);
  if (json) {
    const [, chain = '', partial = ''] = json;
    const items = fieldSuggestions(descend(ctx.input, chain.split('.').filter(Boolean)), partial);
    return items.length ? { from: beforeCaret.length - partial.length, items } : null;
  }
  const nodeName = /\$\(\s*'([^']*)$/.exec(code);
  if (nodeName) {
    const partial = nodeName[1] ?? '';
    const items = Object.keys(ctx.nodes)
      .filter((n) => n.toLowerCase().startsWith(partial.toLowerCase()))
      .map((n) => ({ label: n, insert: `${n.replace(/'/g, "\\'")}')`, detail: 'nó' }));
    return items.length ? { from: beforeCaret.length - partial.length, items } : null;
  }
  const variable = /\$([\w]*)$/.exec(code);
  if (variable) {
    const typed = `$${variable[1] ?? ''}`;
    const items = VARIABLES.filter((v) => v.label.startsWith(typed) && v.label !== typed);
    return items.length ? { from: beforeCaret.length - typed.length, items } : null;
  }
  return null;
}

/** Texto de um valor qualquer: escalares como estão, objetos em JSON, nulo/indefinido vazio. */
export function scalarText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return JSON.stringify(value);
}
