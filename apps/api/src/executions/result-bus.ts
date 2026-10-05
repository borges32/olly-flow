import type { Redis } from 'ioredis';
import type { ExecutionOutcome, WaitResult, WebhookResponse } from './execution-job.js';

/**
 * Resultados das execuções enfileiradas (spec 006, FR-002): o worker grava a resposta do
 * webhook e o desfecho numa chave com TTL e publica no canal da execução. Quem espera assina o
 * canal **antes** de ler a chave, então não perde um resultado publicado nesse intervalo.
 */
const channel = (executionId: string) => `olly:execution:${executionId}`;
const responseKey = (executionId: string) => `olly:execution:${executionId}:response`;
const outcomeKey = (executionId: string) => `olly:execution:${executionId}:outcome`;
/** Tempo que um resultado fica disponível para quem perguntar depois do fim. */
const RESULT_TTL_SECONDS = 600;

type ResultMessage =
  { kind: 'response'; response: WebhookResponse } | { kind: 'finished'; outcome: ExecutionOutcome };

export class ResultPublisher {
  constructor(private readonly redis: Redis) {}

  response(executionId: string, response: WebhookResponse): Promise<void> {
    return this.send(executionId, responseKey(executionId), { kind: 'response', response });
  }

  finished(executionId: string, outcome: ExecutionOutcome): Promise<void> {
    return this.send(executionId, outcomeKey(executionId), { kind: 'finished', outcome });
  }

  private async send(executionId: string, key: string, message: ResultMessage): Promise<void> {
    const raw = JSON.stringify(message);
    await this.redis
      .multi()
      .set(key, raw, 'EX', RESULT_TTL_SECONDS)
      .publish(channel(executionId), raw)
      .exec();
  }
}

/**
 * Espera resultados com uma única conexão de assinatura por processo, com contagem de
 * interessados por canal.
 */
export class ResultSubscriber {
  private readonly listeners = new Map<string, Set<(message: ResultMessage) => void>>();

  constructor(
    private readonly subscriber: Redis,
    private readonly redis: Redis,
  ) {
    subscriber.on('message', (ch: string, raw: string) => {
      const set = this.listeners.get(ch);
      if (!set) return;
      const message = JSON.parse(raw) as ResultMessage;
      for (const listener of set) listener(message);
    });
  }

  async wait(executionId: string, timeoutMs: number, untilResponse: boolean): Promise<WaitResult> {
    const ch = channel(executionId);
    let resolve!: (result: WaitResult) => void;
    const result = new Promise<WaitResult>((r) => {
      resolve = r;
    });
    const listener = (message: ResultMessage) => {
      if (message.kind === 'finished') resolve({ kind: 'finished', outcome: message.outcome });
      else if (untilResponse) resolve({ kind: 'response', response: message.response });
    };
    const timer = setTimeout(() => {
      resolve({ kind: 'timeout' });
    }, timeoutMs);
    await this.listen(ch, listener);
    try {
      const [response, outcome] = await this.redis.mget(
        responseKey(executionId),
        outcomeKey(executionId),
      );
      if (untilResponse && response) listener(JSON.parse(response) as ResultMessage);
      if (outcome) listener(JSON.parse(outcome) as ResultMessage);
      return await result;
    } finally {
      clearTimeout(timer);
      await this.unlisten(ch, listener);
    }
  }

  private async listen(ch: string, listener: (message: ResultMessage) => void): Promise<void> {
    const set = this.listeners.get(ch);
    if (set) {
      set.add(listener);
      return;
    }
    this.listeners.set(ch, new Set([listener]));
    await this.subscriber.subscribe(ch);
  }

  private async unlisten(ch: string, listener: (message: ResultMessage) => void): Promise<void> {
    const set = this.listeners.get(ch);
    set?.delete(listener);
    if (set?.size === 0) {
      this.listeners.delete(ch);
      await this.subscriber.unsubscribe(ch).catch(() => undefined);
    }
  }
}
