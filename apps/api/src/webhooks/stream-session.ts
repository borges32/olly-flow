import type { Logger } from '@nestjs/common';
import {
  STREAM_RESPONSE_HEADERS,
  type ExecutionEvents,
  type ExecutionFinishedEvent,
  type StreamEvent,
  type WorkflowDefinition,
} from '@olly/shared-types';
import type { FastifyReply } from 'fastify';
import type { ExecutionDispatcher } from '../executions/dispatcher.js';
import type { ExecutionEventsService } from '../executions/execution-events.service.js';
import type { WaitResult } from '../executions/execution-job.js';
import { StreamTracker, ndjsonLine } from './stream-events.js';
import type { StreamSlot } from './stream-limiter.js';

/** Espera pelo resultado guardado depois do `executionFinished` (normalmente imediato). */
const RESULT_WAIT_MS = 10_000;

export interface StreamSessionOptions {
  reply: FastifyReply;
  definition: WorkflowDefinition;
  events: ExecutionEventsService;
  dispatcher: ExecutionDispatcher;
  slot: StreamSlot;
  pingMs: number;
  /** Teto do stream: o tempo máximo do workflow mais uma margem (plan §2). */
  maxDurationMs: number;
  /** Conteúdo da resposta final: o mesmo corpo que o modo sem streaming devolveria. */
  finalContent: (result: Exclude<WaitResult, { kind: 'timeout' }>) => unknown;
  logger: Logger;
}

/**
 * Stream de uma execução para quem chamou (spec 027, FR-001 a FR-004, plan §2): assume a
 * resposta HTTP, escreve uma linha NDJSON por evento, manda o sinal periódico, escreve a
 * resposta final (ou o erro, ou a espera) e encerra. A desconexão de quem chamou só libera a
 * vaga: a execução continua.
 */
export class StreamSession {
  private tracker?: StreamTracker;
  private unsubscribe?: () => void;
  private closed = false;
  private lastWrite = Date.now();
  private readonly timers: NodeJS.Timeout[] = [];
  private resolveDone!: () => void;
  /** Termina quando o stream é encerrado (por fim, erro, teto ou desconexão). */
  readonly done = new Promise<void>((resolve) => {
    this.resolveDone = resolve;
  });

  constructor(private readonly opts: StreamSessionOptions) {
    const { reply } = opts;
    // Cabeçalhos já definidos (ex.: CORS) seguem com os do stream.
    const headers = { ...reply.getHeaders(), ...STREAM_RESPONSE_HEADERS };
    reply.hijack();
    reply.raw.writeHead(200, headers as Record<string, string>);
    reply.raw.flushHeaders();
    reply.raw.on('close', () => {
      this.close();
    });
  }

  /** Chamado com a execução gravada e antes do despacho: nenhum evento se perde. */
  attach(executionId: string): void {
    if (this.closed) return;
    const tracker = new StreamTracker(this.opts.definition, executionId);
    this.tracker = tracker;
    this.unsubscribe = this.opts.events.listen(executionId, (event, payload) => {
      this.onEvent(event, payload);
    });
    this.write(tracker.queued());
    this.timers.push(
      setInterval(() => {
        this.opts.slot.refresh();
        if (Date.now() - this.lastWrite >= this.opts.pingMs) this.write(tracker.ping());
      }, this.opts.pingMs),
      setTimeout(() => {
        this.write(tracker.error('O stream passou do tempo máximo do workflow'));
        this.close();
      }, this.opts.maxDurationMs),
    );
  }

  /** Falha antes de a execução existir (ex.: despacho recusado). */
  fail(message: string): void {
    const error: StreamEvent = {
      type: 'error',
      content: message,
      metadata: { executionId: this.tracker?.executionId ?? '', timestamp: Date.now() },
    };
    this.write(error);
    this.close();
  }

  private onEvent<K extends keyof ExecutionEvents>(event: K, payload: ExecutionEvents[K]): void {
    const tracker = this.tracker;
    if (!tracker) return;
    for (const e of tracker.handle(event, payload)) this.write(e);
    if (event === 'executionFinished') {
      void this.finish(tracker, payload as ExecutionFinishedEvent);
    }
  }

  private async finish(tracker: StreamTracker, p: ExecutionFinishedEvent): Promise<void> {
    if (p.status === 'waiting') {
      this.write(tracker.waiting());
      this.close();
      return;
    }
    if (p.status !== 'success') {
      const fallback =
        p.status === 'cancelled'
          ? 'A execução foi interrompida antes do fim'
          : 'O workflow terminou com erro';
      this.write(tracker.error(p.error?.message ?? fallback, p.error?.nodeId));
      this.close();
      return;
    }
    try {
      const result = await this.opts.dispatcher.waitForResult(
        tracker.executionId,
        RESULT_WAIT_MS,
        true,
      );
      if (result.kind === 'timeout') {
        this.write(tracker.error('A resposta da execução não ficou disponível'));
      } else {
        const ref = result.kind === 'response' ? tracker.responderNode : tracker.lastDataNode;
        this.write(tracker.final(this.opts.finalContent(result), ref));
      }
    } catch (error) {
      this.opts.logger.warn(`Resposta do stream ${tracker.executionId}: ${String(error)}`);
      this.write(tracker.error('A resposta da execução não ficou disponível'));
    }
    this.close();
  }

  private write(event: StreamEvent): void {
    if (this.closed || this.opts.reply.raw.writableEnded) return;
    this.opts.reply.raw.write(ndjsonLine(event));
    this.lastWrite = Date.now();
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.unsubscribe?.();
    this.opts.slot.release();
    if (!this.opts.reply.raw.writableEnded) this.opts.reply.raw.end();
    this.resolveDone();
  }
}
