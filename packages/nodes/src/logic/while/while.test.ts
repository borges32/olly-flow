import type { Item } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { fakeContext } from '../../test-support/context.js';
import type { LoopState } from '../../types.js';
import { executeLoopOverItems } from '../loop-over-items/definition.js';
import { executeWhile } from './definition.js';

const state = (): LoopState => ({ index: 0, maxIterations: 10_000, accumulated: [], data: {} });
const items = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ json: { i } }));

describe('spec 007 — FR-005/FR-006: logic.while', () => {
  it('FR-005: enquanto verdadeira, emite em loop; falsa, em done com o acumulado', async () => {
    const loop = state();
    const params = { condition: true, accumulate: 'appendBodyOutput', maxIterations: 5 };
    const first = await executeWhile(
      { inputs: { main: items(1) }, items: items(1) },
      fakeContext({ params, loop }),
    );
    expect(first.loop).toHaveLength(1);
    loop.index = 1;
    await executeWhile(
      { inputs: { continue: [{ json: { page: 1 } }] }, items: [] },
      fakeContext({ params, loop }),
    );
    loop.index = 2;
    const done = await executeWhile(
      { inputs: { continue: [{ json: { page: 2 } }] }, items: [] },
      fakeContext({ params: { ...params, condition: false }, loop }),
    );
    expect(done.loop).toEqual([]);
    expect(done.done?.map((i) => i.json)).toEqual([{ page: 1 }, { page: 2 }]);
    expect(loop.maxIterations).toBe(5);
  });

  it('FR-006: passar do limite com a condição verdadeira é erro explícito', async () => {
    const loop = { ...state(), index: 3 };
    await expect(
      executeWhile(
        { inputs: { continue: items(1) }, items: [] },
        fakeContext({ params: { condition: true, maxIterations: 3 }, loop }),
      ),
    ).rejects.toThrow('Limite de 3 iterações atingido');
  });

  it('FR-005: condição que não resulta em booleano é erro de parâmetro', async () => {
    await expect(
      executeWhile(
        { inputs: { main: items(1) }, items: items(1) },
        fakeContext({ params: { condition: 'talvez' }, loop: state() }),
      ),
    ).rejects.toThrow(/verdadeiro ou falso/);
  });
});

describe('spec 007 — FR-011: logic.loopOverItems', () => {
  it('FR-011: lotes em loop e, ao final, tudo o que voltou em done', async () => {
    const loop = state();
    const params = { batchSize: 10 };
    const all = items(25);
    const sizes: number[] = [];
    let out = await executeLoopOverItems(
      { inputs: { main: all }, items: all },
      fakeContext({ params, loop }),
    );
    while ((out.loop?.length ?? 0) > 0) {
      sizes.push(out.loop?.length ?? 0);
      out = await executeLoopOverItems(
        { inputs: { continue: out.loop ?? [] }, items: [] },
        fakeContext({ params, loop }),
      );
    }
    expect(sizes).toEqual([10, 10, 5]);
    expect(out.done?.map((i) => i.json.i)).toEqual(all.map((i) => i.json.i));
    expect(loop.maxIterations).toBe(3);
  });

  it('FR-011: sem itens, termina direto (done vazio)', async () => {
    const out = await executeLoopOverItems(
      { inputs: { main: [] }, items: [] },
      fakeContext({ params: {}, loop: state() }),
    );
    expect(out).toEqual({ done: [], loop: [] });
  });
});
