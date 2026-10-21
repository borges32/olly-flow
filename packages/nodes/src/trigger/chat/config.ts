import type { ChatAuthentication, ChatConfig, WorkflowNode } from '@olly/shared-types';

/** Autenticações do chat público (spec 021, FR-004), equivalentes às do N8N. */
export const CHAT_AUTHENTICATIONS = ['none', 'basicAuth', 'ollyUserAuth'] as const;

/** Textos padrão da página (os do N8N, em português: NFR-G07). */
export const CHAT_DEFAULTS = {
  initialMessages: 'Olá! 👋\nComo posso ajudar?',
  title: 'Olá! 👋',
  subtitle: 'Comece uma conversa. Estamos aqui para ajudar.',
  inputPlaceholder: 'Digite sua pergunta...',
  getStarted: 'Nova conversa',
} as const;

export interface ChatOptions {
  allowFileUploads: boolean;
  allowedFilesMimeTypes: string;
  allowedOrigins: string;
  title: string;
  subtitle: string;
  inputPlaceholder: string;
  showWelcomeScreen: boolean;
  getStarted: string;
  loadPreviousSession: 'notSupported' | 'memory';
  responseMode: 'lastNode' | 'responseNode' | 'streaming';
}

export interface ChatSettings {
  webhookId: string;
  public: boolean;
  mode: 'hostedChat' | 'webhook';
  authentication: ChatAuthentication;
  initialMessages: string;
  options: ChatOptions;
}

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;

/** Parâmetros do Chat Trigger com os padrões aplicados. */
export function chatSettings(node: Pick<WorkflowNode, 'params'>): ChatSettings {
  const p = node.params;
  const o = (p.options && typeof p.options === 'object' ? p.options : {}) as Record<
    string,
    unknown
  >;
  return {
    webhookId: str(p.webhookId, '').trim(),
    public: p.public === true,
    mode: oneOf(p.mode, ['hostedChat', 'webhook'] as const, 'hostedChat'),
    authentication: oneOf(p.authentication, CHAT_AUTHENTICATIONS, 'none'),
    initialMessages: str(p.initialMessages, CHAT_DEFAULTS.initialMessages),
    options: {
      allowFileUploads: o.allowFileUploads === true,
      allowedFilesMimeTypes: str(o.allowedFilesMimeTypes, '*'),
      allowedOrigins: str(o.allowedOrigins, '*'),
      title: str(o.title, CHAT_DEFAULTS.title),
      subtitle: str(o.subtitle, CHAT_DEFAULTS.subtitle),
      inputPlaceholder: str(o.inputPlaceholder, CHAT_DEFAULTS.inputPlaceholder),
      showWelcomeScreen: o.showWelcomeScreen === true,
      getStarted: str(o.getStarted, CHAT_DEFAULTS.getStarted),
      loadPreviousSession: oneOf(
        o.loadPreviousSession,
        ['notSupported', 'memory'] as const,
        'notSupported',
      ),
      responseMode: oneOf(
        o.responseMode,
        ['lastNode', 'responseNode', 'streaming'] as const,
        'lastNode',
      ),
    },
  };
}

/**
 * Configuração pública da página hospedada (FR-003, NFR-004): só os textos e as opções que a
 * página usa, sem nomes de nós, credenciais ou dados do workflow.
 */
export function chatConfig(settings: ChatSettings): ChatConfig {
  const o = settings.options;
  return {
    title: o.title,
    subtitle: o.subtitle,
    initialMessages:
      settings.mode === 'hostedChat'
        ? settings.initialMessages
            .split('\n')
            .map((m) => m.trim())
            .filter(Boolean)
        : [],
    inputPlaceholder: o.inputPlaceholder,
    showWelcomeScreen: o.showWelcomeScreen,
    getStarted: o.getStarted,
    allowFileUploads: o.allowFileUploads,
    allowedFilesMimeTypes: o.allowFileUploads ? o.allowedFilesMimeTypes : '',
    authentication: settings.authentication,
    loadPreviousSession: o.loadPreviousSession === 'memory',
    streaming: o.responseMode === 'streaming',
  };
}

/** Caminho das rotas do chat publicado (tabela `webhooks`), como o N8N: `<webhookId>/chat`. */
export const chatPath = (webhookId: string) => `${webhookId}/chat`;

/** `webhookId` válido: letras, números e hífen (uuid do editor ou do N8N). */
export const isValidWebhookId = (id: string) => /^[A-Za-z0-9-]{8,64}$/.test(id);
