import { Injectable } from '@nestjs/common';
import type { ExecutionEvents } from '@olly/shared-types';
import type { Namespace } from 'socket.io';

export const executionRoom = (executionId: string) => `execution:${executionId}`;
/** Sala do workflow: o editor entra ao abrir, antes de existir o id da execução. */
export const workflowRoom = (workflowId: string) => `workflow:${workflowId}`;
/** Sala com os dados de execução: só para quem tem `execution:readData` (spec 005, FR-014). */
export const dataRoom = (room: string) => `${room}:data`;

/** Versão do evento sem dados de execução, para quem não tem `execution:readData`. */
function withoutData<K extends keyof ExecutionEvents>(
  event: K,
  payload: ExecutionEvents[K],
): ExecutionEvents[K] {
  if (event === 'nodeFinished') {
    const copy: ExecutionEvents['nodeFinished'] = {
      ...(payload as ExecutionEvents['nodeFinished']),
      data: { input: {}, output: {} },
      dataRedacted: true,
    };
    delete copy.console;
    return copy as ExecutionEvents[K];
  }
  if (event === 'testWebhookReceived') {
    const copy: ExecutionEvents['testWebhookReceived'] = {
      ...(payload as ExecutionEvents['testWebhookReceived']),
    };
    delete copy.payload;
    return copy as ExecutionEvents[K];
  }
  return payload;
}

/** Publica eventos de execução nas salas WebSocket (FR-012 da spec 003). */
@Injectable()
export class ExecutionEventsService {
  private namespace?: Namespace;

  attach(namespace: Namespace): void {
    this.namespace = namespace;
  }

  /**
   * Publica nas salas da execução e do workflow (cada conexão recebe uma vez): o evento completo
   * nas salas de dados e a versão sem dados nas demais.
   */
  emit<K extends keyof ExecutionEvents>(
    event: K,
    payload: ExecutionEvents[K],
    workflowId: string,
  ): void {
    const rooms = [executionRoom(payload.executionId), workflowRoom(workflowId)];
    this.namespace?.to(rooms.map(dataRoom)).emit(event, payload);
    this.namespace?.to(rooms).emit(event, withoutData(event, payload));
  }
}
