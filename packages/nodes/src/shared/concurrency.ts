/**
 * Aplica `fn` a cada item com no máximo `limit` em andamento, preservando a ordem dos
 * resultados (spec 006, FR-009). Com `limit` 1, é o laço sequencial de sempre. Na primeira
 * falha, nenhum item novo começa; os que já estão em andamento terminam e o erro do item de
 * menor índice é lançado (resultado determinístico).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const errors = new Map<number, unknown>();
  let next = 0;
  const worker = async () => {
    while (next < items.length && errors.size === 0) {
      signal?.throwIfAborted();
      const index = next++;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        errors.set(index, error);
      }
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (errors.size > 0) throw errors.get(Math.min(...errors.keys()));
  return results;
}
