import type { ReactNode } from 'react';

export interface ChatEntry {
  id: string;
  role: 'user' | 'bot' | 'error';
  text: string;
  /** Rodapé opcional da mensagem (ex.: link para a execução no editor). */
  meta?: ReactNode;
  /** Momento da mensagem (ISO), quando conhecido (Olly Chat, spec 028, FR-013). */
  at?: string;
}

let counter = 0;
export const chatEntry = (role: ChatEntry['role'], text: string, meta?: ReactNode): ChatEntry => ({
  id: `m${String(++counter)}`,
  role,
  text,
  ...(meta !== undefined && { meta }),
});

/** Texto exibido para a resposta do chat: `output`, `text` ou o JSON (como o servidor). */
export function replyText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const { output, text } = body as { output?: unknown; text?: unknown };
    if (typeof output === 'string') return output;
    if (typeof text === 'string') return text;
  }
  return body === undefined || body === null ? '' : JSON.stringify(body, null, 2);
}

/**
 * Mensagem do histórico (`loadPreviousSession`, spec 021, FR-006), serializada pelo LangChain
 * como no N8N: papel pelo último elemento de `id` e texto em `kwargs.content`.
 */
export function historyMessage(message: unknown): { role: 'user' | 'bot'; text: string } | null {
  if (!message || typeof message !== 'object') return null;
  const { id, kwargs } = message as { id?: unknown; kwargs?: { content?: unknown } };
  const kind = Array.isArray(id) ? String(id[id.length - 1]) : '';
  const content = kwargs?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((c: unknown) => (c && typeof c === 'object' && 'text' in c ? String(c.text) : ''))
            .join('')
        : '';
  if (kind === 'HumanMessage') return { role: 'user', text };
  if (kind === 'AIMessage') return { role: 'bot', text };
  return null;
}
