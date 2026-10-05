import type { CancelReason } from '@olly/engine';
import type { WebhookResponse } from '@olly/nodes';
import type { Item, WorkflowDefinition } from '@olly/shared-types';

/**
 * Trabalho de execução serializável (spec 005, FR-003, plan §2 e §10): tudo o que um executor
 * precisa. Na fila (spec 006), o job leva só o id; o worker remonta este objeto a partir da
 * execução gravada e de `execution_payloads`.
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

/** Dados do disparo guardados fora da fila (`execution_payloads`, spec 006 FR-001). */
export type ExecutionPayload = Pick<
  ExecutionJob,
  'triggerItems' | 'startNodeId' | 'pinData' | 'destinationNodeId' | 'reuse'
>;

export interface ExecutionError {
  nodeId?: string;
  message: string;
  /** Fim antecipado (spec 006): cancelamento, timeout global ou worker perdido. */
  reason?: CancelReason;
}

export interface ExecutionOutcome {
  status: 'success' | 'error' | 'cancelled';
  error?: ExecutionError;
  /** Itens do último nó que terminou com dados (modo de resposta `lastNode`). */
  lastOutput?: Item[];
}

export type WaitResult =
  | { kind: 'response'; response: WebhookResponse }
  | { kind: 'finished'; outcome: ExecutionOutcome }
  | { kind: 'timeout' };

/** Pedido de cancelamento publicado para os workers (spec 006, FR-010). */
export interface CancelMessage {
  executionId: string;
  reason: CancelReason;
  message: string;
}

export type { WebhookResponse };
