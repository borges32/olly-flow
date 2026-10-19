/** Larguras das colunas do painel do nó (spec 025), em %: [entrada, parâmetros, saída]. */
export type ColumnSizes = [number, number, number];

/** Próximo do layout anterior (`1fr 1.1fr 1fr`). */
export const DEFAULT_COLUMN_SIZES: ColumnSizes = [32, 36, 32];
export const MIN_COLUMN_SIZE = 15;
export const COLUMN_SIZES_KEY = 'olly.ndv.columns';

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Move a divisória `handle` (0: entrada|parâmetros; 1: parâmetros|saída) em `delta` pontos
 * percentuais (FR-001): a coluna da esquerda cresce e a da direita diminui na mesma medida, sem
 * passar do mínimo. A terceira coluna não muda.
 */
export function resizeColumns(sizes: ColumnSizes, handle: 0 | 1, delta: number): ColumnSizes {
  const next: ColumnSizes = [...sizes];
  const left = next[handle];
  const right = next[handle + 1] as number;
  const clamped = Math.min(Math.max(delta, MIN_COLUMN_SIZE - left), right - MIN_COLUMN_SIZE);
  next[handle] = round(left + clamped);
  next[handle + 1] = round(right - clamped);
  return next;
}

const isValid = (value: unknown): value is ColumnSizes =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= MIN_COLUMN_SIZE) &&
  Math.abs((value as number[]).reduce((a, b) => a + b, 0) - 100) < 0.5;

/** Preferência do navegador (FR-002); inválida ou indisponível → padrão. */
export function loadColumnSizes(storage: () => Storage): ColumnSizes {
  try {
    const raw = storage().getItem(COLUMN_SIZES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isValid(parsed) ? parsed : [...DEFAULT_COLUMN_SIZES];
  } catch {
    return [...DEFAULT_COLUMN_SIZES];
  }
}

export function saveColumnSizes(storage: () => Storage, sizes: ColumnSizes): void {
  try {
    storage().setItem(COLUMN_SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // Armazenamento indisponível (janela anônima, bloqueio): o ajuste só não é lembrado.
  }
}
