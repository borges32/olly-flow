import { describe, expect, it } from 'vitest';
import {
  TemplateSyntaxError,
  compileTemplate,
  isExpression,
  literalValue,
  parseTemplate,
} from './template.js';
import { collectExpressions, pathToString, substitute } from './params.js';
import { findNodeReferences } from './references.js';

describe('spec 003 — FR-001/FR-002: convenção e parser de templates', () => {
  it('FR-001: só strings iniciadas por "=" são expressões', () => {
    expect(isExpression('={{ 1 }}')).toBe(true);
    expect(isExpression('{{ 1 }}')).toBe(false);
    expect(isExpression(' ={{ 1 }}')).toBe(false);
    expect(isExpression(42)).toBe(false);
  });

  it('FR-002: separa texto e código', () => {
    expect(parseTemplate('Olá {{ $json.nome }}!')).toEqual([
      { type: 'text', value: 'Olá ' },
      { type: 'code', code: ' $json.nome ' },
      { type: 'text', value: '!' },
    ]);
  });

  it('FR-002: "}}" dentro de strings e chaves aninhadas não fecham o trecho', () => {
    expect(parseTemplate('{{ "}}" }}')).toEqual([{ type: 'code', code: ' "}}" ' }]);
    expect(parseTemplate("{{ '}}' + `}}` }}")).toEqual([{ type: 'code', code: " '}}' + `}}` " }]);
    expect(parseTemplate('{{ {a: {b: 1}} }}')).toEqual([{ type: 'code', code: ' {a: {b: 1}} ' }]);
    expect(parseTemplate('{{ "a\\"}}b" }}')).toEqual([{ type: 'code', code: ' "a\\"}}b" ' }]);
  });

  it('FR-002: "{{" sem fechamento é erro de sintaxe', () => {
    expect(() => parseTemplate('Olá {{ $json.nome')).toThrow(TemplateSyntaxError);
  });

  it('FR-002: um único trecho preserva o tipo; template misto concatena', () => {
    expect(compileTemplate(parseTemplate('{{ 1 }}'))).toBe('return __olly_out(( 1 \n));');
    expect(compileTemplate(parseTemplate('a{{ 1 }}'))).toBe('return "a" + __olly_s(( 1 \n));');
    expect(literalValue(parseTemplate('sem código'))).toBe('sem código');
    expect(literalValue(parseTemplate('{{ 1 }}'))).toBeUndefined();
  });
});

describe('spec 003 — FR-003: coleta de expressões e referências a nós', () => {
  it('FR-003: encontra expressões em qualquer profundidade e substitui pelos valores', () => {
    const params = { a: '=x', b: [{ c: '={{ 1 }}', d: 'literal' }], n: 3 };
    const found = collectExpressions(params);
    expect(found.map((f) => pathToString(f.path))).toEqual(['a', 'b[0].c']);
    expect(substitute(params, (path) => `<${pathToString(path)}>`)).toEqual({
      a: '<a>',
      b: [{ c: '<b[0].c>', d: 'literal' }],
      n: 3,
    });
  });

  it('FR-003: detecta $("Nó"), $node["Nó"] e $node.Nó; nome calculado é dinâmico', () => {
    const refs = findNodeReferences([
      '={{ $(\'Busca\').item.json.id }} {{ $("Outro nó").all() }}',
      '={{ $node["Legado"].json.x + $node.Ponto.json.y }}',
    ]);
    expect([...refs.names].sort()).toEqual(['Busca', 'Legado', 'Outro nó', 'Ponto']);
    expect(refs.dynamic).toBe(false);
    expect(findNodeReferences(['={{ $($json.nomeDoNo).item }}']).dynamic).toBe(true);
    expect(findNodeReferences(['={{ $node[$json.n].json }}']).dynamic).toBe(true);
    expect(findNodeReferences(['={{ $json.x }}']).names.size).toBe(0);
  });
});
