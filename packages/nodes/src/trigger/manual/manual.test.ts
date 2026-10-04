import { describe, expect, it } from 'vitest';
import { executeManualTrigger } from './execute.js';

describe('spec 002 — FR-017: trigger.manual', () => {
  it('FR-017: sem itens recebidos, emite um item vazio', async () => {
    expect(await executeManualTrigger({ inputs: {}, items: [] })).toEqual({ main: [{ json: {} }] });
  });

  it('FR-017: emite os itens recebidos', async () => {
    const items = [{ json: { a: 1 } }, { json: { a: 2 } }];
    expect(await executeManualTrigger({ inputs: { main: items }, items })).toEqual({ main: items });
  });
});
