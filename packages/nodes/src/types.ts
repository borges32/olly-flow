import type { JSONSchema7 } from 'json-schema';
import type { BinaryRef, Item, NodeOutput, PortDef, WorkflowNode } from '@olly/shared-types';

export type { JSONSchema7 };

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

/** Extensões aceitas em `paramsSchema`, além do JSON Schema draft-07. */
export const PARAMS_SCHEMA_EXTENSIONS = ['x-display-options', 'x-secret'] as const;

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
}

export interface NodeContext {
  readonly executionId: string;
  readonly workflowId: string;
  readonly node: WorkflowNode;
  /** Valor do parâmetro com expressões já resolvidas para o item. */
  getParam(name: string, itemIndex: number): unknown;
  getCredential(): Promise<Record<string, unknown>>;
  readonly signal: AbortSignal;
  readonly logger: NodeLogger;
  readonly helpers: NodeHelpers;
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
  execute(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput>;
}

/** Visão pública de um nó, sem a função de execução (ex.: `GET /node-types`). */
export type NodeDescription = Omit<NodeDefinition, 'execute'>;
