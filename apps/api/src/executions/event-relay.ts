import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { createRedisConnection } from '../core/redis.js';
import { REDIS } from '../core/tokens.js';
import {
  EXECUTION_EVENTS_CHANNEL,
  ExecutionEventsService,
  type ExecutionEventMessage,
} from './execution-events.service.js';

/**
 * Relay de eventos Redis → WebSocket (spec 006, FR-003): cada instância da API assina o canal
 * e entrega às suas conexões os eventos publicados pelos workers e pelas outras instâncias.
 */
@Injectable()
export class ExecutionEventRelay implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('EventRelay');
  private subscriber?: Redis;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ExecutionEventsService) private readonly events: ExecutionEventsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const subscriber = createRedisConnection(this.config.redisUrl, 'events');
    this.subscriber = subscriber;
    subscriber.on('message', (_channel: string, raw: string) => {
      this.handle(raw);
    });
    // Com o Redis fora do ar, a API sobe mesmo assim: a assinatura é feita quando ele voltar.
    const subscribed = subscriber.subscribe(EXECUTION_EVENTS_CHANNEL).catch((error: unknown) => {
      this.logger.warn(`Assinatura dos eventos falhou: ${String(error)}`);
    });
    await Promise.race([subscribed, new Promise((resolve) => setTimeout(resolve, 2000).unref())]);
    this.events.usePublisher((message) => this.redis.publish(EXECUTION_EVENTS_CHANNEL, message));
  }

  private handle(raw: string): void {
    try {
      const { event, payload, workflowId } = JSON.parse(raw) as ExecutionEventMessage;
      if (typeof event !== 'string' || typeof workflowId !== 'string') return;
      this.events.deliver(event, payload, workflowId);
    } catch (error) {
      this.logger.warn(`Evento de execução inválido no Redis: ${String(error)}`);
    }
  }

  onApplicationShutdown(): void {
    this.subscriber?.disconnect();
  }
}
