import { Injectable } from '@nestjs/common';
import type { ExecutionEvents } from '@olly/shared-types';
import type { Namespace } from 'socket.io';

export const executionRoom = (executionId: string) => `execution:${executionId}`;
/** Sala do workflow: o editor entra ao abrir, antes de existir o id da execução. */
export const workflowRoom = (workflowId: string) => `workflow:${workflowId}`;

/** Publica eventos de execução na sala WebSocket da execução (FR-012). */
@Injectable()
export class ExecutionEventsService {
  private namespace?: Namespace;

  attach(namespace: Namespace): void {
    this.namespace = namespace;
  }

  /** Publica na sala da execução e na do workflow (cada conexão recebe uma vez). */
  emit<K extends keyof ExecutionEvents>(
    event: K,
    payload: ExecutionEvents[K],
    workflowId: string,
  ): void {
    this.namespace
      ?.to([executionRoom(payload.executionId), workflowRoom(workflowId)])
      .emit(event, payload);
  }
}
