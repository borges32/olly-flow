import type { WebhookResponse } from '@olly/nodes';
import type { Item, WorkflowDefinition } from '@olly/shared-types';

/**
 * Trabalho de execução serializável (spec 005, FR-003, plan §2 e §10): tudo o que um executor
 * precisa, para que a fila da spec 006 o leve a um worker sem mudar quem despacha.
 */
export interface ExecutionJob {
  executionId: string;
  workflow: { id: string; name: string; projectId: string; active: boolean };
  definition: WorkflowDefinition;
  mode: 'test' | 'production';
  /** Itens entregues ao nó inicial (ex.: a chamada do webhook). */
  triggerItems?: Item[];
  startNodeId?: string;
  pinData?: Record<string, Item[]>;
  destinationNodeId?: string;
  /** Execução de um nó (spec 003, FR-020): nó → execução de onde vêm os dados. */
  reuse?: Record<string, string>;
}

export interface ExecutionOutcome {
  status: 'success' | 'error';
  error?: { nodeId?: string; message: string };
  /** Itens do último nó que terminou com dados (modo de resposta `lastNode`). */
  lastOutput?: Item[];
}

export type { WebhookResponse };
