/** Tipo do nó Chat Trigger (spec 021). */
export const CHAT_TRIGGER_TYPE = 'trigger.chat';

/** Origem das execuções disparadas pelo chat (spec 021, FR-008). */
export const CHAT_TRIGGER_ORIGIN = 'chat';

export type ChatAuthentication = 'none' | 'basicAuth' | 'ollyUserAuth';

/**
 * Configuração pública da página de chat hospedada (spec 021, FR-003, NFR-004): só o que a
 * página precisa, sem nomes de nós nem dados do workflow.
 */
export interface ChatConfig {
  title: string;
  subtitle: string;
  initialMessages: string[];
  inputPlaceholder: string;
  showWelcomeScreen: boolean;
  getStarted: string;
  allowFileUploads: boolean;
  allowedFilesMimeTypes: string;
  authentication: ChatAuthentication;
  loadPreviousSession: boolean;
}

/** Resposta de uma mensagem do painel de chat do editor (spec 021, FR-002). */
export interface ChatTestReply {
  status: 'success' | 'error' | 'timeout';
  /** Texto a exibir: `output`, `text` ou o JSON da resposta. */
  message: string;
  /** Corpo devolvido ao chat (JSON do último nó ou do nó de resposta). */
  body?: unknown;
  error?: string;
}

/** Resposta de `POST /workflows/:id/chat/test`. */
export interface ChatTestStart {
  executionId: string;
}
