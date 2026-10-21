/** Nó da árvore HTML (hast) que o `react-markdown` passa aos componentes. */
interface HastNode {
  type?: string;
  tagName?: string;
  value?: unknown;
  properties?: { className?: unknown };
  children?: HastNode[];
}

/**
 * Código de um bloco ```mermaid (spec 028, FR-011): o `<pre>` cujo `<code>` tem a classe
 * `language-mermaid`. Qualquer outro bloco: `null` (continua como código).
 */
export function mermaidSource(pre: unknown): string | null {
  const code = (pre as HastNode | undefined)?.children?.find((c) => c.type === 'element');
  const classes = code?.properties?.className;
  if (code?.tagName !== 'code' || !Array.isArray(classes) || !classes.includes('language-mermaid'))
    return null;
  const text = (code.children ?? [])
    .map((c) => (typeof c.value === 'string' ? c.value : ''))
    .join('');
  return text.replace(/\n$/, '');
}
