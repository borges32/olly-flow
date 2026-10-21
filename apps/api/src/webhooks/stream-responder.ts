import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WebhookResponse } from '@olly/nodes';
import type { WorkflowDefinition } from '@olly/shared-types';
import type { FastifyReply } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { ExecutionDispatcher } from '../executions/dispatcher.js';
import { ExecutionEventsService } from '../executions/execution-events.service.js';
import { StreamLimiter } from './stream-limiter.js';
import { StreamSession, type StreamSessionOptions } from './stream-session.js';

/** Margem do teto do stream além do tempo máximo do workflow (spec 027, plan §2). */
const STREAM_GRACE_MS = 30_000;

/**
 * Corpo do "Responder ao webhook" como conteúdo final do stream (spec 027, FR-002): JSON ou
 * texto como estão; binário só pelos metadados (status e cabeçalhos não se aplicam).
 */
export function streamResponseContent(response: WebhookResponse): unknown {
  const body = response.body;
  if (!body) return {};
  if (body.kind === 'json') return body.value;
  if (body.kind === 'text') return body.value;
  return {
    binary: { mimeType: body.ref.mimeType, fileName: body.ref.fileName, size: body.ref.size },
  };
}

/** Uma execução a transmitir: o projeto (limite) e a definição executada (nomes dos nós). */
export interface StreamTarget {
  projectId: string;
  definition: WorkflowDefinition;
}

/**
 * Resposta em streaming do Webhook e do chat (spec 027, plan §2–§5): ocupa a vaga do projeto
 * (ou recusa com 429, sem criar a execução), assume a resposta e transmite os passos até o fim.
 */
@Injectable()
export class StreamResponder {
  private readonly logger = new Logger('Stream');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ExecutionEventsService) private readonly events: ExecutionEventsService,
    @Inject(ExecutionDispatcher) private readonly dispatcher: ExecutionDispatcher,
    @Inject(StreamLimiter) private readonly limiter: StreamLimiter,
  ) {}

  /**
   * `launch` dispara a execução e chama `beforeDispatch` com o id antes do despacho; termina
   * quando o stream é encerrado.
   */
  async stream(
    reply: FastifyReply,
    target: StreamTarget,
    launch: (beforeDispatch: (executionId: string) => void) => Promise<unknown>,
    finalContent: StreamSessionOptions['finalContent'],
  ): Promise<void> {
    const acquired = await this.limiter.acquire(target.projectId);
    if ('limit' in acquired) {
      await reply.code(429).send({
        message: `Limite de streams simultâneos do projeto atingido (${String(acquired.limit)})`,
      });
      return;
    }
    const timeoutSec = target.definition.settings.timeoutSec;
    const session = new StreamSession({
      reply,
      definition: target.definition,
      events: this.events,
      dispatcher: this.dispatcher,
      slot: acquired.slot,
      pingMs: this.config.webhook.streamPingMs,
      maxDurationMs:
        (timeoutSec ? timeoutSec * 1000 : this.config.execution.workflowTimeoutMs) +
        STREAM_GRACE_MS,
      finalContent,
      logger: this.logger,
    });
    try {
      await launch((executionId) => {
        session.attach(executionId);
      });
    } catch (error) {
      this.logger.warn(`Stream: não foi possível iniciar a execução: ${String(error)}`);
      session.fail('Não foi possível iniciar a execução');
    }
    await session.done;
  }
}
