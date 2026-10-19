import { describe, expect, it } from 'vitest';
import {
  COLUMN_SIZES_KEY,
  DEFAULT_COLUMN_SIZES,
  loadColumnSizes,
  resizeColumns,
  saveColumnSizes,
} from './column-sizes';

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  } as unknown as Storage;
  return { data, storage: () => storage };
};

describe('spec 025 — colunas do painel do nó', () => {
  it('FR-001: a divisória muda só as duas colunas vizinhas, na mesma medida', () => {
    expect(resizeColumns([32, 36, 32], 1, 10)).toEqual([32, 46, 22]);
    expect(resizeColumns([32, 36, 32], 0, -7.5)).toEqual([24.5, 43.5, 32]);
  });

  it('FR-001: nenhuma coluna fica abaixo do mínimo (15%)', () => {
    expect(resizeColumns([32, 36, 32], 1, 50)).toEqual([32, 53, 15]);
    expect(resizeColumns([32, 36, 32], 0, -50)).toEqual([15, 53, 32]);
    expect(resizeColumns([15, 53, 32], 0, -5)).toEqual([15, 53, 32]);
  });

  it('FR-002: grava e lê a preferência; valor inválido ou ausente volta ao padrão', () => {
    const { data, storage } = memory();
    expect(loadColumnSizes(storage)).toEqual(DEFAULT_COLUMN_SIZES);
    saveColumnSizes(storage, [20, 50, 30]);
    expect(data.get(COLUMN_SIZES_KEY)).toBe('[20,50,30]');
    expect(loadColumnSizes(storage)).toEqual([20, 50, 30]);
    for (const bad of ['xyz', '[50,50]', '[10,60,30]', '[40,40,40]', '{"a":1}']) {
      expect(loadColumnSizes(memory({ [COLUMN_SIZES_KEY]: bad }).storage)).toEqual(
        DEFAULT_COLUMN_SIZES,
      );
    }
  });

  it('FR-002: sem armazenamento (janela anônima, bloqueio), usa o padrão e não falha', () => {
    const broken = (): Storage => {
      throw new Error('SecurityError');
    };
    expect(loadColumnSizes(broken)).toEqual(DEFAULT_COLUMN_SIZES);
    expect(() => {
      saveColumnSizes(broken, [20, 50, 30]);
    }).not.toThrow();
  });
});
