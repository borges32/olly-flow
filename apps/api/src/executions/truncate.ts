/**
 * Mantém os primeiros itens (porta a porta, na ordem) que cabem em `maxBytes` de JSON (FR-015).
 * Devolve também quantos itens ficaram por porta, para cortar dados paralelos (origens).
 */
export function truncateByBytes<T>(
  data: Record<string, T[]> | undefined,
  maxBytes: number,
): { data: Record<string, T[]>; kept: Record<string, number>; truncated: boolean } {
  const source = data ?? {};
  const full = JSON.stringify(source);
  const keptAll = Object.fromEntries(
    Object.entries(source).map(([port, items]) => [port, items.length]),
  );
  if (Buffer.byteLength(full) <= maxBytes) return { data: source, kept: keptAll, truncated: false };

  // Margem para chaves, colchetes e vírgulas.
  let budget = maxBytes - 64;
  const result: Record<string, T[]> = {};
  const kept: Record<string, number> = {};
  for (const [port, items] of Object.entries(source)) {
    budget -= Buffer.byteLength(JSON.stringify(port)) + 4;
    const out: T[] = [];
    for (const item of items) {
      const size = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (size > budget) break;
      budget -= size;
      out.push(item);
    }
    result[port] = out;
    kept[port] = out.length;
  }
  return { data: result, kept, truncated: true };
}
