import { describe, expect, it } from 'vitest';
import { escapeControlCharsInStrings, jsonTextErrorMessage, parseJsonText } from './json-text.js';

describe('spec 004 — FR-009 (Histórico 19/10/2026): JSON escrito como texto', () => {
  it('FR-009: JSON válido é lido sem correção', () => {
    expect(parseJsonText('{"a": [1, "x"]}')).toEqual({
      ok: true,
      value: { a: [1, 'x'] },
      repaired: false,
    });
  });

  it('FR-009: quebras de linha e tabulações cruas dentro de textos são escapadas (Markdown no corpo)', () => {
    const body =
      '{\n  "messageText": "## Título\n- item\tcom tab\r\nfim",\n  "users": ["a@x.br"]\n}';
    expect(parseJsonText(body)).toEqual({
      ok: true,
      value: { messageText: '## Título\n- item\tcom tab\r\nfim', users: ['a@x.br'] },
      repaired: true,
    });
    // Fora das aspas, e escapes existentes, ficam como estão.
    expect(escapeControlCharsInStrings('{\n"a": "x\\"y\n"}')).toBe('{\n"a": "x\\"y\\n"}');
  });

  it('FR-009: JSON que continua inválido informa linha, coluna e trecho, com a dica do JSON.stringify', () => {
    // Aspas dentro do texto inserido: não há como corrigir sem ambiguidade.
    const body = '{\n  "messageText": "o serviço "rast-bff" caiu",\n  "users": []\n}';
    const result = parseJsonText(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.line).toBe(2);
    expect(result.column).toBeGreaterThan(20);
    expect(result.snippet).toContain('rast-bff');
    const message = jsonTextErrorMessage(result);
    expect(message).toMatch(/^JSON inválido na linha 2, coluna \d+, perto de «.*rast-bff.*»/);
    expect(message).toContain('{{ JSON.stringify($json.campo) }}');
  });
});
