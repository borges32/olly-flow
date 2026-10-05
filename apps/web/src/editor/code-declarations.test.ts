import { describe, expect, it } from 'vitest';
import { codeDeclarations } from './code-declarations';

describe('spec 005 — FR-012: autocomplete do editor de código', () => {
  it('FR-012: declara as variáveis do N8N e tipa $() com os nomes dos nós', () => {
    const dts = codeDeclarations(['Busca', 'Nó "especial"']);
    for (const name of [
      '$input',
      '$json',
      '$vars',
      '$env',
      '$execution',
      '$workflow',
      '$now',
      'DateTime',
      '_',
      'items',
    ]) {
      expect(dts).toContain(`declare const ${name}`);
    }
    expect(dts).toContain(
      'declare function $(nodeName: "Busca" | "Nó \\"especial\\""): OllyNodeData;',
    );
    expect(codeDeclarations([])).toContain('declare function $(nodeName: string)');
  });
});
