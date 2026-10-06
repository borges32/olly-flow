import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage, StoredMessage } from '@langchain/core/messages';

/** Mensagem armazenável (formato do LangChain), para a memória persistente. */
export type StoredChatMessage = StoredMessage;

/** Provedores de modelo (ADR-0008); `fake` só nos testes (FR-016). */
export type ChatModelProvider = 'openai' | 'anthropic' | 'google' | 'fake';

/** O que o sub-nó `ai.chatModel` entrega ao Agent. */
export interface ChatModelSupply {
  provider: ChatModelProvider;
  model: string;
  chatModel: BaseChatModel;
}

/** O que um sub-nó de memória entrega ao Agent (FR-009). */
export interface MemorySupply {
  /** Últimas mensagens da sessão, na ordem. */
  load(): Promise<BaseMessage[]>;
  /** Acrescenta as mensagens novas do turno (pergunta e resposta). */
  save(messages: BaseMessage[]): Promise<void>;
}

/** Ferramenta que o Agent pode chamar (FR-007). Nome único e descrição obrigatória. */
export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema (objeto) dos argumentos. */
  schema: Record<string, unknown>;
  /** Exige aprovação humana antes de executar (FR-010): destrutiva ou marcada pelo editor. */
  requireApproval: boolean;
  /** Tem efeitos colaterais (FR-013: aprovação depois de conteúdo externo). */
  sideEffects: boolean;
  /** O resultado vem de fora (MCP, HTTP): conteúdo não confiável (FR-012, FR-013). */
  external: boolean;
  /** Origem exibida no delimitador do resultado (ex.: `mcp:Servidor/tool`). */
  source: string;
  invoke: (args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
}

export type AgentStepKind = 'model' | 'tool' | 'approval' | 'final' | 'error';

/** Passo registrado (FR-006): o gateway mascara antes de gravar e transmitir. */
export interface AgentStepInput {
  nodeId: string;
  runIndex: number;
  itemIndex: number;
  stepIndex: number;
  kind: AgentStepKind;
  toolName?: string;
  content: unknown;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AiUsageInput {
  nodeId: string;
  provider: ChatModelProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Memória guardada pela API (persistente) ou só na execução (temporária). */
export interface AiMemoryStore {
  load(limit: number): Promise<StoredMessage[]>;
  append(messages: StoredMessage[]): Promise<void>;
}

/**
 * Serviços de IA da plataforma (spec 011), fornecidos pela API ao motor: allowlist de modelos
 * (FR-002), limite mensal (FR-015), uso e custo (FR-014), passos (FR-006), memória (FR-009) e
 * o `fetch` com anti-SSRF para os provedores.
 */
export interface AiGateway {
  /** Lança se o modelo não estiver na lista da instalação e do projeto (FR-002). */
  checkModel: (input: { provider: ChatModelProvider; model: string }) => Promise<void>;
  /** Antes de cada chamada ao modelo: lança se o limite mensal foi atingido (FR-015). */
  beforeModelCall: () => Promise<void>;
  recordUsage: (usage: AiUsageInput) => Promise<void>;
  recordStep: (step: AgentStepInput) => Promise<void>;
  /** Memória persistente da sessão no projeto. */
  persistentMemory: (sessionKey: string) => AiMemoryStore;
  /** Memória temporária: só durante a execução. */
  executionMemory: (nodeId: string, sessionKey: string) => AiMemoryStore;
  /** `fetch` com anti-SSRF para os provedores de modelo. */
  readonly fetch: typeof fetch;
  readonly limits: {
    /** `OLLY_AGENT_MAX_ITERATIONS` (teto global, NFR-001). */
    maxIterations: number;
    /** `OLLY_AGENT_TOOL_RESULT_MAX_CHARS` (FR-012). */
    toolResultMaxChars: number;
  };
  /** Credencial de teste (`fakeLlm`) disponível só com `NODE_ENV=test` (FR-016). */
  readonly allowFakeModel: boolean;
}
