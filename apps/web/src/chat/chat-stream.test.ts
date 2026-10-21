import type { StreamEvent } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { ChatStreamState, NdjsonReader, readChatStream } from './chat-stream';

const meta = { executionId: 'e', timestamp: 1, itemIndex: 0 };
const begin = (nodeId: string, nodeName: string): StreamEvent => ({
  type: 'begin',
  metadata: { ...meta, nodeId, nodeName, nodeType: 'x', runIndex: 0 },
});
const end = (nodeId: string, nodeName: string): StreamEvent => ({
  type: 'end',
  metadata: {
    ...meta,
    nodeId,
    nodeName,
    nodeType: 'x',
    runIndex: 0,
    status: 'success',
    durationMs: 1,
    itemsIn: 1,
    itemsOut: 1,
  },
});
const line = (e: StreamEvent) => `${JSON.stringify(e)}\n`;

describe('spec 027 — chat em streaming na página', () => {
  it('FR-005: junta pedaços em linhas JSON, inclusive a última sem quebra de linha', () => {
    const reader = new NdjsonReader();
    const text = line(begin('a', 'Planner')) + JSON.stringify(end('a', 'Planner'));
    expect(reader.push(text.slice(0, 10))).toEqual([]);
    expect(reader.push(text.slice(10))).toEqual([begin('a', 'Planner')]);
    expect(reader.flush()).toEqual([end('a', 'Planner')]);
    expect(reader.push('não é json\n\n')).toEqual([]);
  });

  it('FR-005: o passo atual é o nó em execução; o item é a resposta e o error, a falha', () => {
    const state = new ChatStreamState();
    state.apply(begin('a', 'Planner'));
    expect(state.step).toBe('Planner');
    state.apply(end('a', 'Planner'));
    expect(state.step).toBeNull();
    state.apply({
      type: 'item',
      content: { output: 'Pronto' },
      metadata: { executionId: 'e', timestamp: 1, final: true },
    });
    expect(state.result).toEqual({ ok: true, body: { output: 'Pronto' } });
    state.apply({ type: 'error', content: 'Falhou', metadata: { executionId: 'e', timestamp: 1 } });
    expect(state.result).toEqual({ ok: false, message: 'Falhou' });
  });

  it('FR-005: lê a resposta aos poucos e avisa cada passo', async () => {
    const body =
      line(begin('a', 'Planner')) +
      line(end('a', 'Planner')) +
      line(begin('b', 'Síntese')) +
      line(end('b', 'Síntese')) +
      line({
        type: 'item',
        content: { output: 'Resposta' },
        metadata: { executionId: 'e', timestamp: 1, final: true },
      });
    const steps: (string | null)[] = [];
    const result = await readChatStream(new Response(body), (s) => steps.push(s));
    expect(steps).toContain('Planner');
    expect(steps).toContain('Síntese');
    expect(result).toEqual({ ok: true, body: { output: 'Resposta' } });
    expect(await readChatStream(new Response(''), () => undefined)).toEqual({
      ok: false,
      message: 'O stream terminou sem resposta',
    });
  });
});
