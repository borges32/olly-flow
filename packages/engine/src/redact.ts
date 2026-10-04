/** Segredos com menos caracteres que isto não são mascarados: trocariam pedaços comuns do texto. */
export const MIN_SECRET_LENGTH = 4;

export const REDACTED = '***';

/**
 * Cópia de `value` com toda ocorrência dos segredos trocada por `***` (spec 004, FR-003).
 * Usado no que é gravado ou transmitido; os dados que trafegam entre os nós não mudam.
 */
export function redactSecrets<T>(value: T, secrets: ReadonlySet<string>): T {
  const list = [...secrets]
    .filter((s) => s.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  if (list.length === 0) return value;
  const redactString = (text: string) =>
    list.reduce(
      (acc, secret) => (acc.includes(secret) ? acc.split(secret).join(REDACTED) : acc),
      text,
    );
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return redactString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Date) return v;
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}
