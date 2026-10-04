import type { Item } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '../../types.js';
import { executeIf } from './execute.js';

interface Condition {
  leftValue: unknown;
  rightValue?: unknown;
  operator: { type: string; operation: string };
}

/**
 * `resolved` simula o resultado do getParam (expressões já avaliadas por item); `raw` são os
 * parâmetros como salvos (para saber se o valor veio de expressão).
 */
function run(
  items: Item[],
  resolved: (i: number) => Condition[],
  options: { combinator?: 'and' | 'or'; loose?: boolean; raw?: Condition[] } = {},
) {
  const raw = options.raw ?? resolved(0);
  const ctx = {
    node: { params: { conditions: { combinator: options.combinator ?? 'and', conditions: raw } } },
    getParam: (name: string, i: number) =>
      name === 'conditions'
        ? { combinator: options.combinator ?? 'and', conditions: resolved(i) }
        : options.loose,
  } as unknown as NodeContext;
  return executeIf({ inputs: { main: items }, items }, ctx);
}

const one = (c: Condition) => run([{ json: {} }], () => [c]);
const passes = async (c: Condition) => ((await one(c)).true?.length ?? 0) === 1;

describe('spec 003 — FR-010: logic.if', () => {
  it('FR-010: encaminha cada item para true ou false, com pairedItem do item original', async () => {
    const items = [{ json: { idade: 34 } }, { json: { idade: 16 } }, { json: { idade: 20 } }];
    const out = await run(
      items,
      (i) => [
        {
          leftValue: items[i]?.json.idade,
          rightValue: '18',
          operator: { type: 'number', operation: 'gte' },
        },
      ],
      {
        raw: [
          {
            leftValue: '={{ $json.idade }}',
            rightValue: '18',
            operator: { type: 'number', operation: 'gte' },
          },
        ],
      },
    );
    expect(out.true).toEqual([
      { json: { idade: 34 }, pairedItem: { item: 0 } },
      { json: { idade: 20 }, pairedItem: { item: 2 } },
    ]);
    expect(out.false).toEqual([{ json: { idade: 16 }, pairedItem: { item: 1 } }]);
  });

  it.each([
    ['string equals', 'string', 'equals', 'Ana', 'Ana', true],
    ['string notEquals', 'string', 'notEquals', 'Ana', 'Bia', true],
    ['string contains', 'string', 'contains', 'Olá Ana', 'Ana', true],
    ['string notContains', 'string', 'notContains', 'Olá', 'Ana', true],
    ['string startsWith', 'string', 'startsWith', 'Ana Souza', 'Ana', true],
    ['string endsWith', 'string', 'endsWith', 'Ana Souza', 'Souza', true],
    ['string regex', 'string', 'regex', 'pedido-123', '/^pedido-\\d+$/', true],
    ['string regex com flag', 'string', 'regex', 'ANA', '/ana/i', true],
    ['string isEmpty', 'string', 'isEmpty', '', '', true],
    ['string isNotEmpty', 'string', 'isNotEmpty', 'x', '', true],
    ['number equals', 'number', 'equals', 5, '5', true],
    ['number notEquals', 'number', 'notEquals', 5, '6', true],
    ['number gt', 'number', 'gt', 5, '4', true],
    ['number gte', 'number', 'gte', 5, '5', true],
    ['number lt', 'number', 'lt', 3, '4', true],
    ['number lte', 'number', 'lte', 4, '4', true],
    ['number isEmpty', 'number', 'isEmpty', null, '', true],
    ['number isNotEmpty', 'number', 'isNotEmpty', 0, '', true],
    ['boolean true', 'boolean', 'true', true, '', true],
    ['boolean false', 'boolean', 'false', false, '', true],
    ['boolean equals', 'boolean', 'equals', true, 'true', true],
    ['dateTime after', 'dateTime', 'after', '2026-10-03T12:00:00Z', '2026-10-01T00:00:00Z', true],
    ['dateTime before', 'dateTime', 'before', '2026-10-03', '2026-12-01', true],
    [
      'dateTime equals entre fusos',
      'dateTime',
      'equals',
      '2026-10-03T12:00:00Z',
      '2026-10-03T09:00:00-03:00',
      true,
    ],
    ['array contains', 'array', 'contains', ['a', 'b'], 'b', true],
    ['array contains número digitado', 'array', 'contains', [1, 2], '2', true],
    ['array lengthEquals', 'array', 'lengthEquals', [1, 2], '2', true],
    ['array isEmpty', 'array', 'isEmpty', [], '', true],
    ['array isNotEmpty', 'array', 'isNotEmpty', [1], '', true],
    ['object isEmpty', 'object', 'isEmpty', {}, '', true],
    ['object isNotEmpty', 'object', 'isNotEmpty', { a: 1 }, '', true],
    ['string equals falso', 'string', 'equals', 'Ana', 'ana', false],
    ['number gt falso', 'number', 'gt', 1, '4', false],
  ] as const)('FR-010: %s', async (_d, type, operation, leftValue, rightValue, expected) => {
    expect(await passes({ leftValue, rightValue, operator: { type, operation } })).toBe(expected);
  });

  it('FR-010: AND exige todas; OR exige uma', async () => {
    const conditions = (): Condition[] => [
      { leftValue: 5, rightValue: '1', operator: { type: 'number', operation: 'gt' } },
      { leftValue: 'a', rightValue: 'b', operator: { type: 'string', operation: 'equals' } },
    ];
    expect((await run([{ json: {} }], conditions, { combinator: 'and' })).true).toHaveLength(0);
    expect((await run([{ json: {} }], conditions, { combinator: 'or' })).true).toHaveLength(1);
    expect((await run([{ json: {} }], () => [])).true).toHaveLength(1);
  });

  it('FR-010: resultado de expressão com tipo errado gera erro (como no N8N)', async () => {
    const cond: Condition = {
      leftValue: '18',
      rightValue: '10',
      operator: { type: 'number', operation: 'gt' },
    };
    const raw: Condition[] = [{ ...cond, leftValue: '={{ $json.idade }}' }];
    await expect(run([{ json: {} }], () => [cond], { raw })).rejects.toThrow(
      /tipo incorreto no valor da esquerda.*espera number/,
    );
  });

  it('FR-010: com conversão flexível, o resultado da expressão é convertido', async () => {
    const cond: Condition = {
      leftValue: '18',
      rightValue: '10',
      operator: { type: 'number', operation: 'gt' },
    };
    const raw: Condition[] = [{ ...cond, leftValue: '={{ $json.idade }}' }];
    expect((await run([{ json: {} }], () => [cond], { raw, loose: true })).true).toHaveLength(1);
  });

  it('FR-010: operação inexistente para o tipo é erro', async () => {
    await expect(
      one({ leftValue: true, operator: { type: 'boolean', operation: 'gt' } }),
    ).rejects.toThrow(/não existe para o tipo boolean/);
  });
});
