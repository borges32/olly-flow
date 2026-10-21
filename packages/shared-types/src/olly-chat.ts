/** Chat da plataforma, "Olly Chat" (spec 028). */
export const OLLY_CHAT_CLIENT = 'chat-olly';
export const OLLY_CHAT_AUTH_TYPES = ['none', 'headerAuth', 'basicAuth'] as const;
export type OllyChatAuthType = (typeof OLLY_CHAT_AUTH_TYPES)[number];
/** Retenção das sessões em dias, a partir da última mensagem (FR-009). */
export const OLLY_CHAT_RETENTION = { default: 7, min: 1, max: 3650 } as const;
export const OLLY_CHAT_MAX_MESSAGE_CHARS = 20_000;
export const OLLY_CHAT_MAX_TITLE_CHARS = 120;

/** Payload enviado ao webhook do assistente (FR-004); a identidade vem do servidor. */
export interface OllyChatPayload {
  chatSessionId: string;
  client: typeof OLLY_CHAT_CLIENT;
  email: string;
  login: string;
  name: string;
  message: string;
}

export interface OllyChatStatus {
  configured: boolean;
}

export interface OllyChatSession {
  id: string;
  number: number;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  /** Resposta em andamento (uma mensagem por vez, FR-007). */
  busy: boolean;
}

export interface OllyChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  createdAt: string;
  /** Resposta ainda em andamento. */
  pending: boolean;
  executionId: string | null;
}

/** `GET /admin/olly-chat`: sem segredos (FR-008). */
export interface OllyChatConfig {
  webhookUrl: string | null;
  retentionDays: number;
  authType: OllyChatAuthType;
  /** Nome do cabeçalho (Header Auth) e usuário (Basic Auth): não são segredos. */
  headerName: string | null;
  basicUser: string | null;
  /** Há um segredo guardado (valor do cabeçalho ou senha), que não volta à tela. */
  hasSecret: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** `PUT /admin/olly-chat`: segredo vazio ou ausente mantém o guardado. */
export interface OllyChatConfigUpdate {
  webhookUrl: string | null;
  retentionDays: number;
  authType: OllyChatAuthType;
  headerName?: string;
  headerValue?: string;
  basicUser?: string;
  basicPassword?: string;
}

/**
 * Texto exibido da resposta do workflow (FR-005, 21/10/2026): o JSON final é como
 * `[ { "client": "chat-olly", "report": "<Markdown>", "memoria": {} } ]` (lista ou objeto). Usa o
 * campo `report`; sem ele, `output` (Agent) ou `text` (Basic LLM Chain); senão o JSON formatado.
 * O JSON pode chegar como texto (Responder ao Webhook em "Texto", `output` de um Agent, bloco
 * ```json): se o texto for um JSON com `report`, vale o `report` dele.
 */
export function ollyChatReplyText(content: unknown): string {
  if (typeof content === 'string') return reportInText(content) ?? content;
  if (content === null || content === undefined) return '';
  const fields = firstObject(content);
  if (typeof fields?.report === 'string') return fields.report;
  for (const value of [fields?.output, fields?.text])
    if (typeof value === 'string') return reportInText(value) ?? value;
  return JSON.stringify(content, null, 2);
}

/** Primeiro objeto da resposta (lista ou objeto; item do N8N `{ json: {...} }` desembrulhado). */
function firstObject(content: unknown): Record<string, unknown> | undefined {
  const first: unknown = Array.isArray(content) ? content[0] : content;
  if (!first || typeof first !== 'object' || Array.isArray(first)) return undefined;
  const fields = first as Record<string, unknown>;
  const { json } = fields;
  if (!('report' in fields) && json && typeof json === 'object' && !Array.isArray(json))
    return json as Record<string, unknown>;
  return fields;
}

/** `report` de um texto que é um JSON (aceita um bloco ```json em volta); senão `undefined`. */
function reportInText(text: string): string | undefined {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*\n([\s\S]*)\n\s*```$/, '$1')
    .trim();
  if (!/^[[{]/.test(trimmed)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const report = firstObject(parsed)?.report;
  return typeof report === 'string' ? report : undefined;
}
