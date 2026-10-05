import type { Item } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { fakeContext } from '../../test-support/context.js';
import { executeSwitch } from './definition.js';

const uf = (value: string) => ({
  conditions: {
    combinator: 'and',
    conditions: [
      {
        leftValue: '={{ $json.uf }}',
        rightValue: value,
        operator: { type: 'string', operation: 'equals' },
      },
    ],
  },
});
const items: Item[] = [{ json: { uf: 'SP' } }, { json: { uf: 'RJ' } }, { json: { uf: 'MG' } }];

/** Simula a resolução de `$json.uf` por item. */
const perItem = (rules: ReturnType<typeof uf>[], extra: Record<string, unknown> = {}) =>
  items.map((item) => ({
    ...extra,
    rules: rules.map((r) => ({
      conditions: {
        ...r.conditions,
        conditions: r.conditions.conditions.map((c) => ({ ...c, leftValue: item.json.uf })),
      },
    })),
  }));

const route = (rules: ReturnType<typeof uf>[], options: Record<string, unknown>) =>
  executeSwitch(
    { inputs: { main: items }, items },
    fakeContext({
      params: perItem(rules, { options }),
      node: { params: { mode: 'rules', rules, options } },
    }),
  );

describe('spec 007 — FR-012: logic.switch', () => {
  it('FR-012: primeira regra verdadeira; sem regra, saída padrão', async () => {
    const out = await route([uf('SP'), uf('RJ')], { fallbackOutput: 'extra' });
    expect(out.output0?.map((i) => i.json.uf)).toEqual(['SP']);
    expect(out.output1?.map((i) => i.json.uf)).toEqual(['RJ']);
    expect(out.fallback?.map((i) => i.json.uf)).toEqual(['MG']);
  });

  it('FR-012: todas as regras verdadeiras; fallback para uma saída existente', async () => {
    const out = await route([uf('SP'), uf('SP')], { allMatchingOutputs: true, fallbackOutput: 1 });
    expect(out.output0?.map((i) => i.json.uf)).toEqual(['SP']);
    expect(out.output1?.map((i) => i.json.uf)).toEqual(['SP', 'RJ', 'MG']);
  });

  it('FR-012: modo expressão roteia pelo índice; índice inválido é erro', async () => {
    const ctx = (values: unknown[]) =>
      fakeContext({
        params: values.map((output) => ({ output, numberOutputs: 2 })),
        node: { params: { mode: 'expression' } },
      });
    const out = await executeSwitch({ inputs: { main: items }, items }, ctx([1, 0, 1]));
    expect(out.output0?.map((i) => i.json.uf)).toEqual(['RJ']);
    expect(out.output1?.map((i) => i.json.uf)).toEqual(['SP', 'MG']);
    await expect(executeSwitch({ inputs: { main: items }, items }, ctx([0, 5, 0]))).rejects.toThrow(
      /de 0 a 1/,
    );
  });
});
