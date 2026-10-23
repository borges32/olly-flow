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
 * ```json, serializado duas vezes) ou embrulhado (`{ output: [...] }` de um parser estruturado,
 * `{ data: [...] }`, item do N8N `{ json: ... }`): o `report` é procurado dentro dele.
 */
export function ollyChatReplyText(content: unknown): string {
  if (content === null || content === undefined) return '';
  const found = replyIn(content, 0);
  if (found !== undefined) return found;
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
}

/** Até onde a busca desce (embrulhos e textos JSON). */
const MAX_DEPTH = 6;

/**
 * Texto da resposta dentro de `value`: num objeto, o `report`; senão `output`/`text` em texto;
 * senão o primeiro achado nos campos. Listas: o primeiro item. Textos JSON são lidos como JSON.
 */
function replyIn(value: unknown, depth: number): string | undefined {
  if (depth > MAX_DEPTH) return undefined;
  if (typeof value === 'string') {
    const parsed = parseJsonText(value);
    return parsed === undefined ? undefined : replyIn(parsed, depth + 1);
  }
  if (Array.isArray(value)) return value.length > 0 ? replyIn(value[0], depth + 1) : undefined;
  if (!value || typeof value !== 'object') return undefined;
  const fields = value as Record<string, unknown>;
  if (typeof fields.report === 'string') return fields.report;
  for (const key of ['output', 'text']) {
    const field = fields[key];
    if (typeof field === 'string') return replyIn(field, depth + 1) ?? field;
  }
  for (const field of Object.values(fields)) {
    if (field === null || typeof field === 'number' || typeof field === 'boolean') continue;
    const found = replyIn(field, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Valor de um texto que é JSON (lista, objeto ou texto entre aspas; aceita um bloco ```json). */
function parseJsonText(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/^```(?:json)?\s*\n([\s\S]*)\n\s*```$/, '$1')
    .trim();
  if (!/^[[{"]/.test(trimmed)) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}
