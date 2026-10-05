import type { Item } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { fakeContext } from '../../test-support/context.js';
import { combineJson, executeMerge } from './execute.js';

const items = (...json: Record<string, unknown>[]): Item[] => json.map((j) => ({ json: j }));
const run = async (params: Record<string, unknown>, inputs: Record<string, Item[]>) =>
  (await executeMerge({ inputs, items: [] }, fakeContext({ params }))).main?.map((i) => i.json);

const db = items({ cpf: '1', nome: 'Ana' }, { cpf: '2', nome: 'Bia' }, { cpf: '3', nome: 'Caio' });
const api = items({ cpf: '1', score: 10 }, { cpf: '3', score: 30 }, { cpf: '9', score: 90 });
const byCpf = { mode: 'combineByFields', fields: [{ input1Field: 'cpf', input2Field: 'cpf' }] };

describe('spec 007 — FR-001/FR-002/FR-003: logic.merge', () => {
  it('FR-002: append concatena as entradas na ordem; FR-001: 3 entradas', async () => {
    expect(
      await run(
        { mode: 'append', numberInputs: 3 },
        { input1: items({ a: 1 }), input2: items({ b: 2 }), input3: items({ c: 3 }) },
      ),
    ).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('SC-004: join à esquerda por cpf', async () => {
    expect(await run({ ...byCpf, joinMode: 'left' }, { input1: db, input2: api })).toEqual([
      { cpf: '1', nome: 'Ana', score: 10 },
      { cpf: '2', nome: 'Bia' },
      { cpf: '3', nome: 'Caio', score: 30 },
    ]);
  });

  it('FR-002: inner, outer e keepNonMatches', async () => {
    expect(await run({ ...byCpf, joinMode: 'inner' }, { input1: db, input2: api })).toHaveLength(2);
    expect(
      (await run({ ...byCpf, joinMode: 'outer' }, { input1: db, input2: api }))?.map((j) => j.cpf),
    ).toEqual(['1', '2', '3', '9']);
    expect(
      (await run({ ...byCpf, joinMode: 'keepNonMatches' }, { input1: db, input2: api }))?.map(
        (j) => j.cpf,
      ),
    ).toEqual(['2', '9']);
  });

  it('FR-002: combinar por campos exige 2 entradas', async () => {
    await expect(
      run({ ...byCpf, numberInputs: 3 }, { input1: db, input2: api, input3: [] }),
    ).rejects.toThrow(/exatamente 2 entradas/);
  });

  it('FR-002: combineByPosition com e sem itens sem par', async () => {
    const inputs = { input1: items({ a: 1 }, { a: 2 }), input2: items({ b: 1 }) };
    expect(await run({ mode: 'combineByPosition' }, inputs)).toEqual([{ a: 1, b: 1 }]);
    expect(await run({ mode: 'combineByPosition', includeUnpaired: true }, inputs)).toEqual([
      { a: 1, b: 1 },
      { a: 2 },
    ]);
  });

  it('FR-003: conflito de campos: entrada 1, última ou sufixo', () => {
    const parts = [
      { json: { id: 1, x: 'a' }, input: 0 },
      { json: { id: 2, y: 'b' }, input: 1 },
    ];
    expect(combineJson(parts, 'preferInput1')).toEqual({ id: 1, x: 'a', y: 'b' });
    expect(combineJson(parts, 'preferLast')).toEqual({ id: 2, x: 'a', y: 'b' });
    expect(combineJson(parts, 'addSuffix')).toEqual({ id_1: 1, id_2: 2, x: 'a', y: 'b' });
  });

  it('FR-003: anyWithData ignora entradas vazias; allConnected as trata como vazias', async () => {
    const inputs = { input1: [], input2: items({ b: 1 }) };
    expect(await run({ mode: 'combineByPosition', waitFor: 'anyWithData' }, inputs)).toEqual([
      { b: 1 },
    ]);
    expect(await run({ mode: 'combineByPosition' }, inputs)).toEqual([]);
  });

  it('FR-002: chooseBranch e waitAll', async () => {
    const inputs = { input1: items({ a: 1 }), input2: items({ b: 2 }) };
    expect(await run({ mode: 'chooseBranch', chosenInput: 2 }, inputs)).toEqual([{ b: 2 }]);
    expect(await run({ mode: 'chooseBranch', output: 'empty' }, inputs)).toEqual([{}]);
    expect(await run({ mode: 'waitAll' }, inputs)).toEqual([{ a: 1 }]);
  });
});
