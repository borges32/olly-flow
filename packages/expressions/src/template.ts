/** Parâmetro string iniciado por `=` é expressão-template (FR-001); o resto é literal. */
export function isExpression(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('=');
}

export type Segment = { type: 'text'; value: string } | { type: 'code'; code: string };

export class TemplateSyntaxError extends Error {
  override name = 'TemplateSyntaxError';
}

/**
 * Separa texto e trechos `{{ ... }}`. O fim do trecho é o primeiro `}}` fora de strings
 * (aspas simples, duplas e crases) e fora de chaves abertas no próprio código, para que
 * `{{ "}}" }}` e `{{ {a: {b: 1}} }}` funcionem.
 */
export function parseTemplate(template: string): Segment[] {
  const segments: Segment[] = [];
  let text = '';
  let i = 0;
  while (i < template.length) {
    if (template.startsWith('{{', i)) {
      const end = findCodeEnd(template, i + 2);
      if (end === -1) throw new TemplateSyntaxError('Trecho "{{" sem o "}}" de fechamento');
      if (text) segments.push({ type: 'text', value: text });
      text = '';
      segments.push({ type: 'code', code: template.slice(i + 2, end) });
      i = end + 2;
    } else {
      text += template.charAt(i);
      i++;
    }
  }
  if (text) segments.push({ type: 'text', value: text });
  return segments;
}

function findCodeEnd(s: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') {
      if (depth > 0) depth--;
      else if (s[i + 1] === '}') return i;
    }
  }
  return -1;
}

/** Template sem trechos de código: o valor é o próprio texto, sem passar pelo sandbox. */
export function literalValue(segments: Segment[]): string | undefined {
  return segments.every((s) => s.type === 'text')
    ? segments.map((s) => s.value).join('')
    : undefined;
}

/**
 * Corpo JS do template (FR-002): um único `{{ }}` devolve o valor com o tipo original;
 * template misto concatena e produz string. A quebra de linha antes do `)` permite
 * comentário `//` no fim do código.
 */
export function compileTemplate(segments: Segment[]): string {
  const [only] = segments;
  if (segments.length === 1 && only?.type === 'code') return `return __olly_out((${only.code}\n));`;
  const parts = segments.map((s) =>
    s.type === 'text' ? JSON.stringify(s.value) : `__olly_s((${s.code}\n))`,
  );
  return `return ${parts.length > 0 ? parts.join(' + ') : '""'};`;
}

/** Trecho para mensagens de erro (FR-007). */
export function snippetOf(template: string, max = 160): string {
  const t = template.startsWith('=') ? template.slice(1) : template;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
