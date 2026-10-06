import { Injectable, Logger } from '@nestjs/common';
import type { ExecutionEvents } from '@olly/shared-types';
import type { Namespace } from 'socket.io';

export const executionRoom = (executionId: string) => `execution:${executionId}`;
/** Sala do workflow: o editor entra ao abrir, antes de existir o id da execução. */
export const workflowRoom = (workflowId: string) => `workflow:${workflowId}`;
/** Sala com os dados de execução: só para quem tem `execution:readData` (spec 005, FR-014). */
export const dataRoom = (room: string) => `${room}:data`;

/** Canal Redis dos eventos de execução (spec 006, FR-003): workers e APIs → todas as APIs. */
export const EXECUTION_EVENTS_CHANNEL = 'olly:execution-events';

export interface ExecutionEventMessage {
  event: keyof ExecutionEvents;
  payload: ExecutionEvents[keyof ExecutionEvents];
  workflowId: string;
}

/** Destino dos eventos de execução: WebSocket na API; Redis no worker (spec 006). */
export abstract class ExecutionEventSink {
  abstract emit<K extends keyof ExecutionEvents>(
    event: K,
    payload: ExecutionEvents[K],
    workflowId: string,
  ): void;
}

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
  if (event === 'agentStep') {
    const copy: ExecutionEvents['agentStep'] = {
      ...(payload as ExecutionEvents['agentStep']),
      contentRedacted: true,
    };
    delete copy.content;
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

/**
 * Publica eventos de execução nas salas WebSocket (FR-012 da spec 003). Com o relay ligado
 * (spec 006, FR-003), o evento passa antes pelo Redis para chegar às conexões de todas as
 * instâncias da API; se o Redis falhar, entrega pelo menos às conexões locais.
 */
@Injectable()
export class ExecutionEventsService extends ExecutionEventSink {
  private readonly logger = new Logger('ExecutionEvents');
  private namespace?: Namespace;
  private publisher?: (message: string) => Promise<unknown>;

  attach(namespace: Namespace): void {
    this.namespace = namespace;
  }

  usePublisher(publisher: (message: string) => Promise<unknown>): void {
    this.publisher = publisher;
  }

  emit<K extends keyof ExecutionEvents>(
    event: K,
    payload: ExecutionEvents[K],
    workflowId: string,
  ): void {
    if (!this.publisher) {
      this.deliver(event, payload, workflowId);
      return;
    }
    const message: ExecutionEventMessage = { event, payload, workflowId };
    this.publisher(JSON.stringify(message)).catch((error: unknown) => {
      this.logger.warn(`Evento ${event} entregue só localmente: ${String(error)}`);
      this.deliver(event, payload, workflowId);
    });
  }

  /**
   * Entrega às conexões desta instância (cada conexão recebe uma vez): o evento completo nas
   * salas de dados e a versão sem dados nas demais.
   */
  deliver<K extends keyof ExecutionEvents>(
    event: K,
    payload: ExecutionEvents[K],
    workflowId: string,
  ): void {
    const rooms = [executionRoom(payload.executionId), workflowRoom(workflowId)];
    this.namespace?.to(rooms.map(dataRoom)).emit(event, payload);
    this.namespace?.to(rooms).emit(event, withoutData(event, payload));
  }
}
