import { describe, expect, it } from 'vitest';
import { truncateByBytes } from './truncate.js';

describe('spec 003 — FR-015: truncamento dos dados de nó', () => {
  it('FR-015: dados dentro do limite ficam intactos', () => {
    const data = { main: [{ json: { a: 1 } }] };
    expect(truncateByBytes(data, 1024)).toEqual({ data, kept: { main: 1 }, truncated: false });
  });

  it('FR-015: acima do limite guarda os primeiros itens que cabem e sinaliza', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ json: { i, texto: 'x'.repeat(100) } }));
    const result = truncateByBytes({ main: items }, 2048);
    expect(result.truncated).toBe(true);
    expect(result.kept.main).toBeGreaterThan(0);
    expect(result.kept.main).toBeLessThan(100);
    expect(result.data.main).toEqual(items.slice(0, result.kept.main));
    expect(Buffer.byteLength(JSON.stringify(result.data))).toBeLessThanOrEqual(2048);
  });

  it('FR-015: um único item maior que o limite resulta em lista vazia, sinalizada', () => {
    const result = truncateByBytes(
      { main: [{ json: { big: 'x'.repeat(5000) } }], other: [] },
      1024,
    );
    expect(result).toEqual({
      data: { main: [], other: [] },
      kept: { main: 0, other: 0 },
      truncated: true,
    });
  });
});
