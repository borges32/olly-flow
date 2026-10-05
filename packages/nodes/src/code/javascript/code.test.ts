import { describe, expect, it } from 'vitest';
import { fakeContext } from '../../test-support/context.js';
import { codeJavascriptNode, DEFAULT_CODE } from './definition.js';
import { normalizeItems } from './normalize.js';

describe('spec 005 — FR-011: normalização do retorno do código', () => {
  it('FR-011: objeto, array de objetos e array de { json } viram itens', () => {
    expect(normalizeItems({ a: 1 })).toEqual([{ json: { a: 1 } }]);
    expect(normalizeItems([{ a: 1 }, { b: 2 }])).toEqual([{ json: { a: 1 } }, { json: { b: 2 } }]);
    expect(
      normalizeItems([{ json: { a: 1 }, binary: { data: { id: 'x', mimeType: 'a/b' } } }]),
    ).toEqual([{ json: { a: 1 }, binary: { data: { id: 'x', mimeType: 'a/b' } } }]);
    expect(normalizeItems([])).toEqual([]);
  });

  it.each([
    [42, 'O retorno é number'],
    ['texto', 'O retorno é string'],
    [null, 'O retorno é null'],
    [[1, 2], 'O elemento 0 do retorno é number'],
    [[{ a: 1 }, [2]], 'O elemento 1 do retorno é array'],
    [undefined, 'O código não retornou nada (use `return`)'],
  ])('FR-011: %j gera erro descritivo', (value, description) => {
    expect(() => normalizeItems(value)).toThrow(
      expect.objectContaining({
        message: 'O código deve retornar um objeto ou array de objetos',
        details: { description },
      }) as Error,
    );
  });
});

describe('spec 005 — FR-009: nó code.javascript', () => {
  it('FR-009: código padrão e modo vêm do parâmetro bruto; resultado é normalizado', async () => {
    const calls: unknown[] = [];
    const ctx = fakeContext({
      params: { mode: 'runOnceForAllItems', jsCode: '={{ não é expressão }}' },
      runCode: (req) => {
        calls.push(req);
        return Promise.resolve([{ a: 1 }]);
      },
    });
    const out = await codeJavascriptNode.execute({ inputs: {}, items: [] }, ctx);
    expect(calls).toEqual([{ code: '={{ não é expressão }}', mode: 'runOnceForAllItems' }]);
    expect(out).toEqual({ main: [{ json: { a: 1 } }] });
    expect(DEFAULT_CODE.runOnceForEachItem).toContain('$input.item');
  });

  it('FR-009/FR-011: por item, cada retorno vira um item ligado à origem; array por item é erro', async () => {
    const run = (result: unknown) =>
      codeJavascriptNode.execute(
        { inputs: {}, items: [] },
        fakeContext({
          params: { mode: 'runOnceForEachItem', jsCode: 'x' },
          runCode: () => Promise.resolve(result),
        }),
      );
    expect(await run([{ json: { a: 1 } }, { b: 2 }])).toEqual({
      main: [
        { json: { a: 1 }, pairedItem: { item: 0 } },
        { json: { b: 2 }, pairedItem: { item: 1 } },
      ],
    });
    await expect(run([[{ a: 1 }]])).rejects.toThrow(
      'No modo por item, o código deve retornar um único objeto',
    );
  });
});
