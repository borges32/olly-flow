import { describe, expect, it } from 'vitest';
import { mermaidSource } from './mermaid-source';

const pre = (className: string[] | undefined, value: string) => ({
  type: 'element',
  tagName: 'pre',
  children: [
    {
      type: 'element',
      tagName: 'code',
      properties: { className },
      children: [{ type: 'text', value }],
    },
  ],
});

describe('spec 028 — FR-011: bloco mermaid no Markdown do chat', () => {
  it('FR-011: devolve o código do bloco ```mermaid, sem a quebra de linha final', () => {
    expect(mermaidSource(pre(['language-mermaid'], 'flowchart LR\n  A --> B\n'))).toBe(
      'flowchart LR\n  A --> B',
    );
  });

  it('FR-011: outros blocos continuam como código', () => {
    expect(mermaidSource(pre(['language-json'], '{}'))).toBeNull();
    expect(mermaidSource(pre(undefined, 'texto'))).toBeNull();
    expect(mermaidSource(undefined)).toBeNull();
    expect(mermaidSource({ type: 'element', tagName: 'pre', children: [] })).toBeNull();
  });
});
