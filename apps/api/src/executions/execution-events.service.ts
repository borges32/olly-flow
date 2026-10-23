import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ExecutionEvents } from '@olly/shared-types';
import type { Redis } from 'ioredis';
import type { Namespace } from 'socket.io';
import { REDIS } from '../core/tokens.js';
import { RunningSteps } from './running-steps.js';

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

/** Ouvinte dos eventos de uma execução (spec 027). */
export type ExecutionEventListener = <K extends keyof ExecutionEvents>(
  event: K,
  payload: ExecutionEvents[K],
) => void;

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
  /** Spec 027: ouvintes por execução nesta instância (streams do webhook e do chat). */
  private readonly listeners = new Map<string, Set<ExecutionEventListener>>();
  /** Spec 029, FR-005: passos em andamento, gravados só por quem emite (não pelo relay). */
  readonly runningSteps?: RunningSteps;

  constructor(@Optional() @Inject(REDIS) redis?: Redis) {
    super();
    if (redis) this.runningSteps = new RunningSteps(redis);
  }

  /** Recebe os eventos da execução entregues a esta instância; devolve o cancelamento. */
  listen(executionId: string, listener: ExecutionEventListener): () => void {
    let set = this.listeners.get(executionId);
    if (!set) {
      set = new Set();
      this.listeners.set(executionId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(executionId);
    };
  }

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
    this.runningSteps?.track(event, payload);
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
    for (const listener of this.listeners.get(payload.executionId) ?? []) {
      try {
        listener(event, payload);
      } catch (error) {
        this.logger.warn(`Ouvinte do evento ${event} falhou: ${String(error)}`);
      }
    }
    const rooms = [executionRoom(payload.executionId), workflowRoom(workflowId)];
    const full = rooms.map(dataRoom);
    this.namespace?.to(full).emit(event, payload);
    // Spec 029: a conexão numa sala com dados (o editor) e noutra sem (o acompanhamento ao vivo)
    // recebe só a versão completa; a sem dados chegaria depois e apagaria a saída no canvas.
    this.namespace?.to(rooms).except(full).emit(event, withoutData(event, payload));
  }
}
