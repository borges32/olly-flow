/** Textos maiores que isto não são analisados (mantém o painel leve). */
const MAX_PARSE_CHARS = 1_000_000;

const isContainer = (v: unknown): v is Record<string, unknown> | unknown[] =>
  typeof v === 'object' && v !== null;

/** Objeto ou lista JSON guardado como texto; outro texto (ou JSON escalar) → `undefined`. */
function parseJsonText(text: string): Record<string, unknown> | unknown[] | undefined {
  const trimmed = text.trim();
  if (trimmed.length > MAX_PARSE_CHARS) return undefined;
  const first = trimmed[0];
  const last = trimmed.at(-1);
  if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isContainer(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const childPath = (path: string, key: string | number) =>
  typeof key === 'number'
    ? `${path}[${String(key)}]`
    : /^[A-Za-z_$][\w$]*$/.test(key)
      ? path
        ? `${path}.${key}`
        : key
      : `${path}[${JSON.stringify(key)}]`;

/**
 * Visão JSON do painel do nó (spec 003, FR-017, Histórico 19/10/2026): campos de texto que
 * contêm um objeto ou lista JSON aparecem expandidos, inclusive JSON dentro de JSON. Só a
 * visualização muda: os dados (e o que os nós seguintes recebem) continuam texto. Devolve também
 * os caminhos expandidos, relativos ao item (sem repetição), para o aviso do painel.
 */
export function expandJsonStrings(items: unknown[]): { value: unknown[]; paths: string[] } {
  const paths = new Set<string>();
  const walk = (value: unknown, path: string): unknown => {
    if (typeof value === 'string') {
      const parsed = parseJsonText(value);
      if (parsed === undefined) return value;
      paths.add(path);
      return walk(parsed, path);
    }
    if (Array.isArray(value)) return value.map((v, i) => walk(v, childPath(path, i)));
    if (isContainer(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, walk(v, childPath(path, k))]),
      );
    }
    return value;
  };
  const value = items.map((item) => walk(item, ''));
  return { value, paths: [...paths].filter(Boolean) };
}
