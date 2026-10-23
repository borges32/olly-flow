import type { ExecutionSteps, NodeFinishedEvent } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { applyLiveEvent, applyLiveEvents, type LiveEvent } from './live-execution';

const ID = '0a1b2c3d-0000-4000-8000-000000000000';
const t = (ms: number) => new Date(Date.UTC(2026, 9, 23, 10, 0, 0) + ms).toISOString();

const base: ExecutionSteps = {
  id: ID,
  workflowId: 'wf',
  projectId: 'p',
  workflowVersion: 1,
  mode: 'production',
  triggerType: 'webhook',
  status: 'running',
  startedAt: t(0),
  finishedAt: null,
  error: null,
  resumeAt: null,
  nodes: [
    { id: 'm', name: 'Webhook', type: 'trigger.webhook' },
    { id: 'h', name: 'HTTP', type: 'http.request' },
    { id: 'w', name: 'Esperar', type: 'flow.wait' },
  ],
  nodeCount: 3,
  executedNodeIds: ['m'],
  total: 1,
  steps: [
    {
      nodeId: 'm',
      nodeName: 'Webhook',
      nodeType: 'trigger.webhook',
      runIndex: 0,
      status: 'success',
      startedAt: t(0),
      finishedAt: t(5),
      itemsIn: 1,
      itemsOut: 1,
      error: null,
    },
  ],
  running: [],
  subExecutions: [],
};

const started = (nodeId: string, at: number, runIndex = 0): LiveEvent => ({
  type: 'nodeStarted',
  payload: { executionId: ID, nodeId, runIndex, startedAt: t(at) },
});
const finished = (
  nodeId: string,
  durationMs: number,
  extra: Partial<NodeFinishedEvent> = {},
): LiveEvent => ({
  type: 'nodeFinished',
  payload: {
    executionId: ID,
    nodeId,
    runIndex: 0,
    status: 'success',
    itemsIn: 1,
    itemsOut: 2,
    durationMs,
    pinned: false,
    reused: false,
    dataTruncated: false,
    data: { input: {}, output: {} },
    dataRedacted: true,
    error: null,
    ...extra,
  },
});

describe('spec 029 — estado ao vivo do acompanhamento', () => {
  it('FR-004: o nó que começa entra em andamento, com o nome e o tipo da definição', () => {
    const s = applyLiveEvent(base, started('h', 10));
    expect(s.running).toEqual([
      { nodeId: 'h', nodeName: 'HTTP', nodeType: 'http.request', runIndex: 0, startedAt: t(10) },
    ]);
    expect(s.executedNodeIds).toEqual(['m', 'h']);
  });

  it('FR-004: ao terminar, sai de em andamento e vira passo com status, duração e itens', () => {
    const s = applyLiveEvents(base, [started('h', 10), finished('h', 1500)]);
    expect(s.running).toEqual([]);
    expect(s.total).toBe(2);
    expect(s.steps[1]).toEqual({
      nodeId: 'h',
      nodeName: 'HTTP',
      nodeType: 'http.request',
      runIndex: 0,
      status: 'success',
      startedAt: t(10),
      finishedAt: t(1510),
      itemsIn: 1,
      itemsOut: 2,
      error: null,
    });
  });

  it('FR-005/FR-009: eventos repetidos ou já presentes na consulta não duplicam', () => {
    const events = [started('h', 10), finished('h', 1500)];
    const once = applyLiveEvents(base, events);
    // Ressincronização: a nova consulta já traz o passo, e os mesmos eventos chegam de novo.
    const again = applyLiveEvents(once, [...events, ...events]);
    expect(again.steps.map((s) => s.nodeId)).toEqual(['m', 'h']);
    expect(again.total).toBe(2);
    expect(again.running).toEqual([]);
    // O início que chega depois do fim (evento guardado durante a consulta) é ignorado.
    expect(applyLiveEvent(once, started('h', 10)).running).toEqual([]);
  });

  it('FR-003: nós em paralelo ficam todos em andamento e os passos seguem a ordem de início', () => {
    const s1 = applyLiveEvents(base, [started('h', 10), started('w', 20)]);
    expect(s1.running.map((r) => r.nodeId)).toEqual(['h', 'w']);
    const s2 = applyLiveEvents(s1, [finished('w', 100), finished('h', 1000)]);
    expect(s2.steps.map((s) => s.nodeId)).toEqual(['m', 'h', 'w']);
  });

  it('FR-016: limita as linhas às últimas N e o total continua subindo', () => {
    let s = base;
    for (let i = 1; i <= 5; i++) {
      s = applyLiveEvents(
        s,
        [{ ...started('h', i * 10, i) }, { ...finished('h', 1, { runIndex: i }) }] as LiveEvent[],
        3,
      );
    }
    expect(s.total).toBe(6);
    expect(s.steps.map((x) => x.runIndex)).toEqual([3, 4, 5]);
  });

  it('FR-016: o fim de um passo que ficou fora das últimas linhas não entra de novo', () => {
    const truncated = { ...base, total: 900 };
    const s = applyLiveEvent(truncated, finished('h', 10, { runIndex: 7 }));
    // Sem o início, a hora vem do relógio; um passo bem mais antigo que a primeira linha é ignorado.
    expect(s.total).toBeGreaterThanOrEqual(900);
    const old: LiveEvent = {
      type: 'nodeFinished',
      payload: { ...(finished('h', 10).payload as NodeFinishedEvent), runIndex: 3 },
    };
    const withStart = applyLiveEvents(truncated, [
      {
        type: 'nodeStarted',
        payload: { executionId: ID, nodeId: 'h', runIndex: 3, startedAt: t(-1000) },
      },
      old,
    ]);
    expect(withStart.total).toBe(900);
    expect(withStart.steps).toHaveLength(1);
  });

  it('FR-006/FR-008: o erro do passo e o fim da execução, que limpa os em andamento', () => {
    const s = applyLiveEvents(base, [
      started('h', 10),
      finished('h', 30, { status: 'error', error: { name: 'Error', message: 'timeout' } }),
      started('w', 50),
      {
        type: 'executionFinished',
        payload: {
          executionId: ID,
          status: 'error',
          finishedAt: t(60),
          error: { message: 'Falhou no HTTP', nodeId: 'h' },
        },
      },
    ]);
    expect(s.steps[1]?.error?.message).toBe('timeout');
    expect(s).toMatchObject({ status: 'error', finishedAt: t(60), running: [] });
    expect(s.error?.message).toBe('Falhou no HTTP');
  });

  it('FR-007: a espera e a retomada (o passo aguardando volta a rodar sem duplicar)', () => {
    const waiting = applyLiveEvents(base, [
      started('w', 10),
      finished('w', 5, { status: 'waiting' }),
      {
        type: 'executionFinished',
        payload: { executionId: ID, status: 'waiting', finishedAt: null, error: null },
      },
    ]);
    expect(waiting.status).toBe('waiting');
    expect(waiting.steps.at(-1)?.status).toBe('waiting');
    const resumed = applyLiveEvents({ ...waiting, resumeAt: t(120_000) }, [
      { type: 'executionStarted', payload: { executionId: ID, workflowId: 'wf', startedAt: t(0) } },
      started('w', 120_000),
    ]);
    expect(resumed).toMatchObject({ status: 'running', resumeAt: null });
    expect(resumed.running.map((r) => r.nodeId)).toEqual(['w']);
    expect(resumed.steps.map((s) => s.nodeId)).toEqual(['m']);
    const done = applyLiveEvent(resumed, finished('w', 3));
    expect(done.steps.map((s) => [s.nodeId, s.status])).toEqual([
      ['m', 'success'],
      ['w', 'success'],
    ]);
    expect(done.total).toBe(2);
  });

  it('eventos de outra execução são ignorados', () => {
    const other: LiveEvent = {
      type: 'nodeStarted',
      payload: { executionId: 'outra', nodeId: 'h', runIndex: 0, startedAt: t(1) },
    };
    expect(applyLiveEvent(base, other)).toBe(base);
  });
});
