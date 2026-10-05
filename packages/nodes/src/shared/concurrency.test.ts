import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('spec 006 — FR-009: processamento de itens com concorrência limitada', () => {
  it('FR-009: respeita o limite e preserva a ordem dos resultados', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([50, 10, 30, 5, 20, 1], 3, async (ms, i) => {
      active++;
      peak = Math.max(peak, active);
      await delay(ms);
      active--;
      return i * 10;
    });
    expect(result).toEqual([0, 10, 20, 30, 40, 50]);
    expect(peak).toBe(3);
  });

  it('FR-009: com limite 1 é sequencial e para no primeiro erro', async () => {
    const seen: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2, 3], 1, async (i) => {
        seen.push(i);
        if (i === 1) throw new Error('falhou 1');
        return Promise.resolve(i);
      }),
    ).rejects.toThrow('falhou 1');
    expect(seen).toEqual([0, 1]);
  });

  it('FR-008/FR-009: em paralelo, lança o erro do item de menor índice', async () => {
    await expect(
      mapWithConcurrency([0, 1, 2], 3, async (i) => {
        await delay(i === 0 ? 30 : 1);
        throw new Error(`falhou ${i}`);
      }),
    ).rejects.toThrow('falhou 0');
  });
});
