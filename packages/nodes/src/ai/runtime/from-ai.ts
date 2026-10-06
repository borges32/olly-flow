/** Uma ocorrência de `$fromAI(chave, descrição?, tipo?, padrão?)` nos parâmetros da ferramenta. */
export interface FromAIArgument {
  key: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  hasDefault: boolean;
}

const TYPES = new Set(['string', 'number', 'boolean', 'json']);
// `$fromAI('chave', 'descrição', 'tipo', padrão)`: aspas simples, duplas ou crase.
const CALL =
  /\$fromAI\(\s*(['"`])((?:\\.|(?!\1).)*)\1(?:\s*,\s*(['"`])((?:\\.|(?!\3).)*)\3)?(?:\s*,\s*(['"`])(\w+)\5)?(\s*,\s*[^)]+)?\s*\)/g;

/** Chave aceita (como no N8N): letras, números, `_` e `-`, até 64. */
export const FROM_AI_KEY = /^[a-zA-Z0-9_-]{1,64}$/;

function collect(value: unknown, out: FromAIArgument[]): void {
  if (typeof value === 'string') {
    if (!value.startsWith('=')) return;
    for (const match of value.matchAll(CALL)) {
      const key = (match[2] ?? '').replace(/\\(.)/g, '$1');
      const description = match[4]?.replace(/\\(.)/g, '$1');
      const type =
        match[6] && TYPES.has(match[6]) ? (match[6] as FromAIArgument['type']) : 'string';
      out.push({ key, ...(description && { description }), type, hasDefault: Boolean(match[7]) });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collect(v, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) collect(v, out);
  }
}

/** Ocorrências de `$fromAI()` nos parâmetros (FR-007), sem repetir chaves. */
export function fromAIArguments(params: Record<string, unknown>): FromAIArgument[] {
  const found: FromAIArgument[] = [];
  collect(params, found);
  const byKey = new Map<string, FromAIArgument>();
  for (const arg of found) {
    const current = byKey.get(arg.key);
    // A primeira descrição/tipo explícitos valem.
    if (!current || (!current.description && arg.description)) byKey.set(arg.key, arg);
  }
  return [...byKey.values()];
}

/**
 * JSON Schema dos argumentos da ferramenta gerado a partir das ocorrências de `$fromAI()`
 * (plan §4): o modelo preenche esses campos; o restante dos parâmetros é fixo.
 */
export function fromAISchema(params: Record<string, unknown>): Record<string, unknown> {
  const args = fromAIArguments(params);
  for (const arg of args) {
    if (!FROM_AI_KEY.test(arg.key)) {
      throw new Error(`$fromAI: chave "${arg.key}" inválida (letras, números, _ e -, até 64)`);
    }
  }
  const properties: Record<string, unknown> = {};
  for (const arg of args) {
    const type = arg.type === 'json' ? {} : { type: arg.type };
    properties[arg.key] = { ...type, ...(arg.description && { description: arg.description }) };
  }
  return {
    type: 'object',
    properties,
    required: args.filter((a) => !a.hasDefault).map((a) => a.key),
    additionalProperties: false,
  };
}
