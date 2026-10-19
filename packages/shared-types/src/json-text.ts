/**
 * JSON escrito como texto num parâmetro (ex.: corpo JSON da Requisição HTTP, com `{{ }}` no meio).
 * Spec 004, FR-009 (Histórico 19/10/2026).
 */
export type JsonTextResult =
  | { ok: true; value: unknown; repaired: boolean }
  | { ok: false; message: string; line: number; column: number; snippet: string };

/**
 * Escapa caracteres de controle crus (quebra de linha, tabulação...) dentro de textos entre
 * aspas. É a causa mais comum de JSON inválido quando uma expressão insere um texto de várias
 * linhas (ex.: Markdown) entre aspas, e a correção não é ambígua.
 */
export function escapeControlCharsInStrings(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      else if (code < 0x20) {
        out +=
          ch === '\n'
            ? '\\n'
            : ch === '\r'
              ? '\\r'
              : ch === '\t'
                ? '\\t'
                : `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }
    } else if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

/** Posição (0-based) do erro na mensagem do `JSON.parse` (V8: "at position N"; Firefox: linha/coluna). */
function errorOffset(message: string, text: string): number {
  const position = /position (\d+)/.exec(message);
  if (position) return Number(position[1]);
  const lineCol = /line (\d+) column (\d+)/.exec(message);
  if (lineCol) {
    const lines = text.split('\n');
    const line = Math.min(Number(lineCol[1]), lines.length);
    return lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + Number(lineCol[2]) - 1;
  }
  return text.length;
}

/**
 * Lê o JSON do texto. Se só os caracteres de controle dentro de textos o invalidam, corrige e
 * informa `repaired`. Senão, devolve a linha, a coluna e o trecho do erro.
 */
export function parseJsonText(text: string): JsonTextResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown, repaired: false };
  } catch (error) {
    const repairedText = escapeControlCharsInStrings(text);
    if (repairedText !== text) {
      try {
        return { ok: true, value: JSON.parse(repairedText) as unknown, repaired: true };
      } catch {
        // O erro informado é o do texto original (as posições batem com o que o usuário vê).
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    const offset = Math.max(0, Math.min(errorOffset(message, text), text.length));
    const before = text.slice(0, offset);
    const line = before.split('\n').length;
    const column = offset - before.lastIndexOf('\n');
    const snippet = text
      .slice(Math.max(0, offset - 30), offset + 30)
      .replace(/\s+/g, ' ')
      .trim();
    return { ok: false, message, line, column, snippet };
  }
}

/** Mensagem do erro, em português, com a dica para valores com aspas ou quebras de linha. */
export function jsonTextErrorMessage(result: Extract<JsonTextResult, { ok: false }>): string {
  return (
    `JSON inválido na linha ${String(result.line)}, coluna ${String(result.column)}, perto de «${result.snippet}» ` +
    `(${result.message}). Se um valor pode ter aspas ou quebras de linha, use ` +
    '{{ JSON.stringify($json.campo) }} sem aspas em volta'
  );
}
