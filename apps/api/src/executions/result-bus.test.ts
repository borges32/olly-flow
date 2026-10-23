import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import type { ExecutionOutcome } from './execution-job.js';
import { ResultSubscriber } from './result-bus.js';

const EXECUTION = 'e1';
const channel = `olly:execution:${EXECUTION}`;
const responseKey = `olly:execution:${EXECUTION}:response`;
const outcomeKey = `olly:execution:${EXECUTION}:outcome`;

const response = {
  kind: 'response' as const,
  response: {
    statusCode: 200,
    headers: {},
    body: { kind: 'json' as const, value: { report: 'ok' } },
  },
};
const outcome: ExecutionOutcome = { status: 'success', lastOutput: [{ json: { memoria: '{}' } }] };
const finished = { kind: 'finished' as const, outcome };

/**
 * Redis falso: o desfecho publicado chega pela assinatura enquanto a leitura das chaves ainda
 * não voltou (a disputa vista no Olly Chat, spec 028, em 23/10/2026).
 */
function fakeRedis(keys: Record<string, string>) {
  const subscriber = new EventEmitter() as EventEmitter & {
    subscribe: () => Promise<void>;
    unsubscribe: () => Promise<void>;
  };
  subscriber.subscribe = () => Promise.resolve();
  subscriber.unsubscribe = () => Promise.resolve();
  const redis = {
    mget: (...names: string[]) => {
      subscriber.emit('message', channel, JSON.stringify(finished));
      return Promise.resolve(names.map((n) => keys[n] ?? null));
    },
    get: (name: string) => Promise.resolve(keys[name] ?? null),
  };
  return new ResultSubscriber(subscriber as unknown as Redis, redis as unknown as Redis);
}

describe('spec 006/027 — espera do resultado da execução', () => {
  it('Responder ao webhook: a resposta gravada prevalece sobre o desfecho que chega antes', async () => {
    const results = fakeRedis({
      [responseKey]: JSON.stringify(response),
      [outcomeKey]: JSON.stringify(finished),
    });
    expect(await results.wait(EXECUTION, 1000, true)).toEqual(response);
  });

  it('sem resposta gravada, vale o desfecho (modo "último nó")', async () => {
    const results = fakeRedis({ [outcomeKey]: JSON.stringify(finished) });
    expect(await results.wait(EXECUTION, 1000, true)).toEqual(finished);
  });

  it('quem não espera a resposta recebe o desfecho', async () => {
    const results = fakeRedis({
      [responseKey]: JSON.stringify(response),
      [outcomeKey]: JSON.stringify(finished),
    });
    expect(await results.wait(EXECUTION, 1000, false)).toEqual(finished);
  });
});
