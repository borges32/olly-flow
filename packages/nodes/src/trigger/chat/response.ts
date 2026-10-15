import type { Item } from '@olly/shared-types';

/**
 * Corpo devolvido ao chat no modo "Quando o último nó terminar" (spec 021, FR-005): o JSON do
 * primeiro item do último nó, como o webhook (spec 005) e o N8N.
 */
export function chatResponseBody(lastOutput: Item[] | undefined): Record<string, unknown> {
  return lastOutput?.[0]?.json ?? {};
}

/**
 * Texto exibido na página e no painel do editor: `output` (Agent) ou `text` (Basic LLM Chain),
 * se forem texto; senão, o JSON formatado.
 */
export function chatMessageText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const { output, text } = body as { output?: unknown; text?: unknown };
    if (typeof output === 'string') return output;
    if (typeof text === 'string') return text;
  }
  if (body === undefined || body === null) return '';
  return JSON.stringify(body, null, 2);
}

/**
 * Tipo de arquivo permitido (FR-007): lista separada por vírgula, com curingas (`image/*`) e `*`.
 * Vazio: nenhum.
 */
export function fileAllowed(mimeType: string, allowed: string): boolean {
  const type = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  return allowed
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule === '*' || rule === '*/*') return true;
      if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
      return type === rule;
    });
}
