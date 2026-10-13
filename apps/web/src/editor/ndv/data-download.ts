import type { Item } from '@olly/shared-types';

/** Spec 019, FR-002: o arquivo traz o mesmo que a visão JSON (e o que o editor de dados fixados aceita). */
export function itemsFileContent(items: Item[]): Record<string, unknown>[] {
  return items.map((i) => i.json);
}

// Caracteres inválidos em nomes de arquivo (Windows, macOS, Linux); os de controle, à parte.
const INVALID_FILE_CHARS = /[/\\:*?"<>|]/g;
const safeChar = (c: string) => (c.charCodeAt(0) < 32 ? '_' : c);

/**
 * Spec 019, FR-003: nome do arquivo baixado a partir das partes (nó, entrada/saída, porta,
 * execução do laço), unidas por `-`, sem caracteres inválidos.
 */
export function dataFileName(parts: (string | undefined)[]): string {
  const name = parts
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join('-')
    .replace(INVALID_FILE_CHARS, '_')
    .split('')
    .map(safeChar)
    .join('');
  return `${name || 'dados'}.json`;
}
