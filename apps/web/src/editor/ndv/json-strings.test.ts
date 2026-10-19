import { describe, expect, it } from 'vitest';
import { expandJsonStrings } from './json-strings';

describe('spec 003 — FR-017 (Histórico 19/10/2026): JSON em texto na visão JSON', () => {
  it('FR-017: expande objeto e lista guardados como texto, inclusive JSON dentro de JSON', () => {
    const items = [
      {
        output: '{"plano": {"passos": 2}, "extra": "[1, 2]"}',
        lista: ' [ {"a": 1} ] ',
        nome: 'Ana',
      },
      { output: '{"plano": null}' },
    ];
    const { value, paths } = expandJsonStrings(items);
    expect(value).toEqual([
      { output: { plano: { passos: 2 }, extra: [1, 2] }, lista: [{ a: 1 }], nome: 'Ana' },
      { output: { plano: null } },
    ]);
    // Caminhos relativos ao item, sem repetição.
    expect(paths).toEqual(['output', 'output.extra', 'lista']);
    // Os dados originais não mudam.
    expect(items[0]?.output).toBe('{"plano": {"passos": 2}, "extra": "[1, 2]"}');
  });

  it('FR-017: texto comum, JSON escalar e JSON inválido continuam texto', () => {
    const items = [
      {
        texto: 'olá {mundo}',
        numero: '42',
        verdadeiro: 'true',
        aspas: '"x"',
        quebrado: '{"a": }',
        vazio: '',
        aninhado: { 'chave com espaço': '{"b": 2}', lista: ['[3]'] },
      },
    ];
    const { value, paths } = expandJsonStrings(items);
    expect(value).toEqual([
      {
        texto: 'olá {mundo}',
        numero: '42',
        verdadeiro: 'true',
        aspas: '"x"',
        quebrado: '{"a": }',
        vazio: '',
        aninhado: { 'chave com espaço': { b: 2 }, lista: [[3]] },
      },
    ]);
    expect(paths).toEqual(['aninhado["chave com espaço"]', 'aninhado.lista[0]']);
  });
});
