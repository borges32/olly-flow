import type { JSONSchema7, JSONSchema7Definition } from 'json-schema';
import type { BinaryRef, Item, NodeOutput, PortDef, WorkflowNode } from '@olly/shared-types';
import type { ResolvedCredential } from './credentials/definitions.js';

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
] as const;

/** Origens de opções dinâmicas (`x-load-options`). */
export const LOAD_OPTIONS_SOURCES = [
  'postgresSchemas',
  'postgresTables',
  'postgresColumns',
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
  runCode(request: { code: string; mode: CodeMode }): Promise<unknown>;
  /** Grava a resposta do webhook; só a primeira vale (devolve `false` nas seguintes). */
  respondToWebhook(response: WebhookResponse): boolean;
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
}

/** Visão pública de um nó, sem a função de execução (ex.: `GET /node-types`). */
export type NodeDescription = Omit<NodeDefinition, 'execute'>;
