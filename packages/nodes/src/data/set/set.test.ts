import type { Item } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { NodeParameterError } from '../../errors.js';
import type { NodeContext } from '../../types.js';
import { executeSet } from './execute.js';

function ctx(params: Record<string, unknown>, onError?: string): NodeContext {
  return {
    getParam: (name: string) => params[name],
    node: {
      id: 's',
      type: 'data.set',
      name: 'Set',
      params,
      position: [0, 0],
      settings: { onError },
    },
  } as unknown as NodeContext;
}

async function run(items: Item[], params: Record<string, unknown>) {
  return (await executeSet({ inputs: { main: items }, items }, ctx(params))).main;
}

describe('spec 002 — FR-018: data.set', () => {
  it('FR-018: define campos tipados e preserva os existentes', async () => {
    const out = await run([{ json: { id: 1 } }], {
      includeOtherFields: true,
      fields: [
        { name: 'nome', type: 'string', value: 'Ana' },
        { name: 'idade', type: 'number', value: '34' },
        { name: 'ativo', type: 'boolean', value: 'TRUE' },
        { name: 'tags', type: 'json', value: '["a","b"]' },
      ],
    });
    expect(out).toEqual([
      {
        json: { id: 1, nome: 'Ana', idade: 34, ativo: true, tags: ['a', 'b'] },
        pairedItem: { item: 0 },
      },
    ]);
  });

  it('FR-018: notação de ponto cria campos aninhados', async () => {
    const out = await run([{ json: { cliente: { id: 7 } } }], {
      includeOtherFields: true,
      fields: [
        { name: 'cliente.nome', type: 'string', value: 'Ana' },
        { name: 'endereco.cidade.nome', type: 'string', value: 'Recife' },
      ],
    });
    expect(out?.[0]?.json).toEqual({
      cliente: { id: 7, nome: 'Ana' },
      endereco: { cidade: { nome: 'Recife' } },
    });
  });

  it('FR-018: keepOnlySet mantém somente os campos definidos', async () => {
    const out = await run(
      [{ json: { a: 1, b: 2 }, binary: { f: { id: 'x', mimeType: 'text/plain' } } }],
      {
        fields: [{ name: 'c', type: 'number', value: '3' }],
        keepOnlySet: true,
      },
    );
    expect(out).toEqual([{ json: { c: 3 }, pairedItem: { item: 0 } }]);
  });

  it('FR-018: processa cada item e preenche pairedItem', async () => {
    const out = await run([{ json: { n: 1 } }, { json: { n: 2 } }], {
      includeOtherFields: true,
      fields: [{ name: 'ok', type: 'boolean', value: 'false' }],
    });
    expect(out?.map((i) => i.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
    expect(out?.map((i) => i.json)).toEqual([
      { n: 1, ok: false },
      { n: 2, ok: false },
    ]);
  });

  it('FR-018: não altera o item de entrada', async () => {
    const input: Item = { json: { a: { b: 1 } } };
    await run([input], { fields: [{ name: 'a.c', type: 'number', value: '2' }] });
    expect(input.json).toEqual({ a: { b: 1 } });
  });

  it.each([
    ['number', 'abc', /não é um número/],
    ['number', '', /não é um número/],
    ['boolean', 'sim', /não é um booleano/],
    ['json', '{x', /não é um JSON válido/],
  ])('FR-018: conversão inválida para %s gera erro claro', async (type, value, message) => {
    const promise = run([{ json: {} }], { fields: [{ name: 'campo', type, value }] });
    await expect(promise).rejects.toThrow(NodeParameterError);
    await expect(promise).rejects.toThrow(message);
  });

  it('FR-018: nome de campo vazio é rejeitado', async () => {
    await expect(
      run([{ json: {} }], { fields: [{ name: ' ', type: 'string', value: 'x' }] }),
    ).rejects.toThrow(/nome do campo vazio/);
  });
});

describe('spec 003 — FR-008: data.set com expressões e incluir os demais campos', () => {
  it('FR-008: por padrão mantém só os campos definidos', async () => {
    const out = await run([{ json: { a: 1 } }], {
      fields: [{ name: 'b', type: 'number', value: '2' }],
    });
    expect(out?.[0]?.json).toEqual({ b: 2 });
  });

  it('FR-008: includeOtherFields inclui os demais campos e binários', async () => {
    const binary = { f: { id: 'x', mimeType: 'text/plain' } };
    const out = await run([{ json: { a: 1 }, binary }], {
      includeOtherFields: true,
      fields: [{ name: 'b', type: 'number', value: '2' }],
    });
    expect(out?.[0]).toEqual({ json: { a: 1, b: 2 }, binary, pairedItem: { item: 0 } });
  });

  it('FR-008: alias da spec 002 — keepOnlySet: false inclui os demais campos', async () => {
    const out = await run([{ json: { a: 1 } }], {
      keepOnlySet: false,
      fields: [{ name: 'b', type: 'number', value: '2' }],
    });
    expect(out?.[0]?.json).toEqual({ a: 1, b: 2 });
  });

  it('FR-008: valores vindos de expressões já resolvidas são convertidos pelo tipo', async () => {
    const out = await run([{ json: {} }], {
      fields: [
        { name: 'n', type: 'number', value: 34 },
        { name: 's', type: 'string', value: 34 },
        { name: 'o', type: 'json', value: { x: 1 } },
        { name: 'b', type: 'boolean', value: true },
      ],
    });
    expect(out?.[0]?.json).toEqual({ n: 34, s: '34', o: { x: 1 }, b: true });
  });
});

describe('spec 007 — FR-013: saída de erro por item no data.set', () => {
  it('FR-013: com errorOutput, o item que falha vai para error e os demais seguem', async () => {
    const items = [{ json: { n: '1' } }, { json: { n: 'x' } }, { json: { n: '3' } }];
    const perItem = (i: number) => ({
      fields: [{ name: 'n', type: 'number', value: items[i]?.json.n }],
    });
    const c = {
      ...ctx({}, 'errorOutput'),
      getParam: (name: string, i: number) => (perItem(i) as Record<string, unknown>)[name],
    };
    const out = await executeSet({ inputs: { main: items }, items }, c);
    expect(out.main?.map((i) => i.json)).toEqual([{ n: 1 }, { n: 3 }]);
    expect(out.error).toHaveLength(1);
    expect(out.error?.[0]).toMatchObject({
      json: { n: 'x', error: { message: expect.stringContaining('número') as string } },
      pairedItem: { item: 1 },
    });
  });
});
