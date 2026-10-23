import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ExecutionEvents } from '@olly/shared-types';
import type { Redis } from 'ioredis';
import { REDIS } from '../core/tokens.js';
import {
  EXECUTION_EVENTS_CHANNEL,
  ExecutionEventSink,
  type ExecutionEventMessage,
} from '../executions/execution-events.service.js';
import { RunningSteps } from '../executions/running-steps.js';

/**
 * Eventos de execução do worker vão para o Redis; a API os entrega por WebSocket (FR-003). Spec
 * 029: o worker também mantém os passos em andamento (`RunningSteps`).
 */
@Injectable()
export class RedisEventPublisher extends ExecutionEventSink {
  private readonly logger = new Logger('WorkerEvents');

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    super();
  }

  emit<K extends keyof ExecutionEvents>(
    event: K,
    payload: ExecutionEvents[K],
    workflowId: string,
  ): void {
    const message: ExecutionEventMessage = { event, payload, workflowId };
    // Spec 029, FR-005: os passos em andamento mudam junto com a publicação, na mesma transação.
    RunningSteps.apply(this.redis.multi(), event, payload)
      .publish(EXECUTION_EVENTS_CHANNEL, JSON.stringify(message))
      .exec()
      .catch((e: unknown) => {
        this.logger.warn(`Evento ${event} não publicado: ${String(e)}`);
      });
  }
}
