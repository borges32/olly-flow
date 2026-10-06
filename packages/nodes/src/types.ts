import type { JSONSchema7, JSONSchema7Definition } from 'json-schema';
import type {
  BinaryRef,
  DynamicPorts,
  Item,
  NodeOutput,
  PortDef,
  WorkflowNode,
} from '@olly/shared-types';
import type { McpToolDefinition } from '@olly/shared-types';
import type { ResolvedCredential } from './credentials/definitions.js';
import type { AiGateway } from './ai/runtime/types.js';

export type { JSONSchema7, JSONSchema7Definition };

export const NODE_CATEGORIES = [
  'trigger',
  'logic',
  'data',
  'code',
  'ai',
  'integration',
  'flow',
] as const;
export type NodeCategory = (typeof NODE_CATEGORIES)[number];

/**
 * Extensões aceitas em `paramsSchema`, além do JSON Schema draft-07. Da spec 004:
 * `x-no-expression` (campo sem modo expressão), `x-multiline` (área de texto) e
 * `x-load-options` (opções buscadas no catálogo do banco da credencial do nó).
 */
export const PARAMS_SCHEMA_EXTENSIONS = [
  'x-display-options',
  'x-secret',
  'x-hidden',
  'x-no-expression',
  'x-multiline',
  'x-load-options',
  // Spec 005: campo editado no editor de código (valor: linguagem).
  'x-code-editor',
  // Spec 010: formulário gerado do `inputSchema` da tool MCP selecionada (valor: nome do
  // parâmetro com o servidor; a tool vem de `toolName`).
  'x-mcp-arguments',
] as const;

/** Origens de opções dinâmicas (`x-load-options`). */
export const LOAD_OPTIONS_SOURCES = [
  'postgresSchemas',
  'postgresTables',
  'postgresColumns',
  // Spec 010: servidores MCP ativos no projeto e as tools liberadas do servidor escolhido.
  'mcpServers',
  'mcpTools',
  // Spec 008: workflows publicados do projeto (sub-workflow).
  'workflows',
  // Spec 011: modelos permitidos (instalação e projeto).
  'aiModels',
] as const;
export type LoadOptionsSource = (typeof LOAD_OPTIONS_SOURCES)[number];

export interface NodeExecuteInput {
  /** Itens por porta de entrada. */
  inputs: Record<string, Item[]>;
  /** Atalho para `inputs.main` (ou lista vazia). */
  items: Item[];
}

export interface NodeLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface NodeHelpers {
  /** Marca `item` como originado do item de entrada `itemIndex`. */
  pairedItem(item: Item, itemIndex: number, input?: number): Item;
  getBinary(ref: BinaryRef): Promise<Uint8Array>;
  putBinary(data: Uint8Array, meta: Omit<BinaryRef, 'id' | 'size'>): Promise<BinaryRef>;
  /** Valor sensível derivado (ex.: token OAuth2): é mascarado nos dados gravados (spec 004, FR-003). */
  registerSecret(value: string): void;
}

/** Modos do nó de código (spec 005), com os nomes do N8N. */
export type CodeMode = 'runOnceForAllItems' | 'runOnceForEachItem';

/** Resposta HTTP do webhook definida pelo nó "Responder ao webhook" (spec 005, FR-008). */
export interface WebhookResponse {
  statusCode: number;
  headers: Record<string, string>;
  /** `json`: serializado como JSON; `text`: texto; `binary`: referência no object storage. */
  body?:
    | { kind: 'json'; value: unknown }
    | { kind: 'text'; value: string }
    | { kind: 'binary'; ref: BinaryRef };
}

/**
 * Estado de um laço em andamento (spec 007, plan §3–§4), mantido pelo motor para o nó de laço
 * (While, Loop Over Items) entre a entrada `main` e cada volta pela `continue`.
 */
export interface LoopState {
  /** Voltas concluídas: 0 na entrada `main`, 1 na primeira `continue`... (`$loop.index`). */
  index: number;
  /** Limite de iterações do laço (`$loop.maxIterations`); o nó o define na entrada `main`. */
  maxIterations: number;
  /** Itens acumulados pelo nó (`$loop.accumulated`). */
  accumulated: Item[];
  /** Estado próprio do nó (ex.: fila de lotes). */
  data: Record<string, unknown>;
}

/** Identifica a chamada MCP no registro (`mcp_calls`, spec 010 FR-011). */
export interface McpCallRef {
  serverId: string;
  nodeId: string;
  runIndex: number;
  itemIndex: number;
  /** Credencial do nó (prevalece sobre a do catálogo, FR-007). */
  credential?: ResolvedCredential;
  signal?: AbortSignal;
}

/** Resultado de `tools/call` (FR-010). `content` segue a especificação MCP. */
export interface McpToolCallResult {
  content: Record<string, unknown>[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Acesso governado aos servidores MCP do catálogo (spec 010, plan §5–§6), fornecido pela API ao
 * motor: só servidores ativos e disponíveis no projeto; tools negadas por padrão (FR-002) e
 * bloqueadas se mudaram desde a aprovação (FR-003); cada operação é registrada com os
 * argumentos mascarados (FR-011) e as negações, auditadas (FR-012).
 */
export interface McpGateway {
  /** Tool liberada, com o schema aprovado; lança se negada ou alterada (registra e audita). */
  prepareTool(ref: McpCallRef & { toolName: string }): Promise<McpToolDefinition>;
  callTool(
    ref: McpCallRef & { toolName: string; arguments: Record<string, unknown> },
  ): Promise<McpToolCallResult>;
  /** Somente as tools liberadas no projeto. */
  listTools(ref: McpCallRef): Promise<McpToolDefinition[]>;
  /**
   * Spec 011: tools liberadas para um agente, com a marcação de destrutiva (política) e se são
   * somente leitura (anotação `readOnlyHint` do servidor).
   */
  agentTools(
    ref: McpCallRef,
  ): Promise<{ definition: McpToolDefinition; destructive: boolean; readOnly: boolean }[]>;
  listResources(ref: McpCallRef): Promise<Record<string, unknown>[]>;
  readResource(ref: McpCallRef & { uri: string }): Promise<{ contents: Record<string, unknown>[] }>;
  listPrompts(ref: McpCallRef): Promise<Record<string, unknown>[]>;
  getPrompt(
    ref: McpCallRef & { name: string; arguments: Record<string, string> },
  ): Promise<{ description?: string; messages: Record<string, unknown>[] }>;
}

/**
 * Sub-workflows (spec 008, FR-009 a FR-011), fornecido pela API: verifica a permissão do dono
 * da execução, a publicação do alvo, a profundidade e a recursão, e vincula a execução filha.
 */
export interface SubWorkflowGateway {
  run: (request: {
    workflowId: string;
    items: Item[];
    /** Aguarda o fim e devolve os itens do último nó do filho. */
    wait: boolean;
    signal?: AbortSignal;
  }) => Promise<{ executionId: string; status: string; items: Item[] }>;
  /** Spec 011: nome e schema de entrada (do gatilho) do workflow publicado. */
  describe: (
    workflowId: string,
  ) => Promise<{ name: string; inputSchema: Record<string, unknown> | null }>;
}

/** Retomada de um nó que entrou em espera (spec 008, FR-012). */
export interface NodeResume {
  /** `data` do `NodeWaitSignal` que pausou o nó. */
  data: unknown;
  /** O que retomou: `{ kind: 'time' }` ou as decisões de aprovação (spec 011). */
  value: unknown;
}

export interface NodeContext {
  readonly executionId: string;
  readonly workflowId: string;
  readonly node: WorkflowNode;
  /** Valor do parâmetro com expressões já resolvidas para o item. */
  getParam(name: string, itemIndex: number): unknown;
  /** Grava uma variável da execução, lida pelas expressões seguintes em `$vars` (spec 003). */
  setVariable(name: string, value: unknown): void;
  /** Credencial do nó (`node.credentialId`), decifrada (spec 004). */
  getCredential(): Promise<ResolvedCredential>;
  readonly signal: AbortSignal;
  readonly logger: NodeLogger;
  readonly helpers: NodeHelpers;
  /**
   * Executa código JavaScript de usuário no sandbox (spec 005, FR-009) com os dados do nó;
   * devolve o retorno bruto (uma vez) ou a lista de retornos por item. A saída do `console` vai
   * para o registro do nó.
   */
  runCode(request: { code: string; mode: CodeMode; items?: Item[] }): Promise<unknown>;
  /** Grava a resposta do webhook; só a primeira vale (devolve `false` nas seguintes). */
  respondToWebhook(response: WebhookResponse): boolean;
  /**
   * Processa itens com a concorrência do nó (spec 006, FR-009): em paralelo quando o tipo tem
   * `supportsParallelItems` e o nó liga `settings.parallelItems`; senão, um por vez. A ordem dos
   * resultados é a dos itens. Na primeira falha nenhum item novo começa, e vale o erro do item de
   * menor índice.
   */
  mapItems<T, R>(items: readonly T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]>;
  /** Só nos nós de laço (spec 007): estado do laço em andamento. */
  readonly loop?: LoopState;
  /** Teto global de iterações (`OLLY_MAX_LOOP_ITERATIONS`, spec 007 NFR-001). */
  readonly maxLoopIterations: number;
  /** Execução deste nó na execução (0, 1... nos laços; spec 010: registro das chamadas MCP). */
  readonly runIndex: number;
  /** Servidores MCP do catálogo (spec 010). Lança se o motor não recebeu o gateway. */
  mcp(): McpGateway;
  /** Sub-workflows (spec 008). Lança se o motor não recebeu o gateway. */
  subWorkflows(): SubWorkflowGateway;
  /** Presente quando o nó é retomado depois de uma espera (spec 008, FR-012). */
  readonly resume?: NodeResume;
  /**
   * Spec 011, FR-001: o que os sub-nós ligados à porta do tipo `kind` fornecem para o item
   * (modelo, memória, ferramentas), na ordem das conexões.
   */
  subNodes(kind: SubNodeKind, itemIndex: number): Promise<SubNodeSupply[]>;
  /**
   * Spec 011, FR-007: parâmetros deste nó resolvidos com os valores de `$fromAI()` (sub-nó de
   * ferramenta, na chamada feita pelo modelo).
   */
  withFromAI(
    values: Record<string, unknown>,
    itemIndex: number,
  ): Promise<(name: string) => unknown>;
  /** Serviços de IA (spec 011). Lança se o motor não recebeu o gateway. */
  ai(): AiGateway;
}

export type SubNodeKind = 'ai_languageModel' | 'ai_memory' | 'ai_tool';

/** O que um sub-nó fornece, com o nó de origem. */
export interface SubNodeSupply {
  node: WorkflowNode;
  type: string;
  data: unknown;
}

export interface NodeDefinition {
  type: string;
  version: number;
  displayName: string;
  description: string;
  icon: string;
  category: NodeCategory;
  inputs: PortDef[];
  /** Podem ser dinâmicas (Merge, Switch). */
  outputs: PortDef[];
  /** Portas calculadas a partir dos parâmetros (spec 007): ver `resolveNodePorts`. */
  dynamicPorts?: DynamicPorts;
  /** Gera o formulário; extensões em `PARAMS_SCHEMA_EXTENSIONS`. */
  paramsSchema: JSONSchema7;
  credentialTypes?: string[];
  supportsParallelItems?: boolean;
  /**
   * Altera o estado da execução (ex.: `$vars`): numa execução de um nó, roda de novo em vez de
   * reaproveitar a saída anterior, para que os nós seguintes vejam o mesmo estado (spec 003, FR-020).
   */
  rerunOnPartialExecution?: boolean;
  execute(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput>;
  /**
   * Sub-nó (spec 011, FR-001): não executa no fluxo; o nó ao qual está ligado pede o que ele
   * fornece (modelo, memória, ferramentas) para cada item.
   */
  supplyData?(ctx: NodeContext, itemIndex: number): Promise<unknown>;
}

/** Visão pública de um nó, sem a função de execução (ex.: `GET /node-types`). */
export type NodeDescription = Omit<NodeDefinition, 'execute'>;
