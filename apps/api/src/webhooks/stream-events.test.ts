import type { NodeFinishedEvent, WorkflowDefinition } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { StreamTracker, ndjsonLine } from './stream-events.js';

const definition: WorkflowDefinition = {
  nodes: [
    { id: 'w', type: 'trigger.webhook', name: 'Webhook', params: {}, position: [0, 0] },
    { id: 'p', type: 'ai.agentix', name: 'Planner', params: {}, position: [0, 0] },
    { id: 'r', type: 'http.respondToWebhook', name: 'Responder', params: {}, position: [0, 0] },
  ],
  edges: [],
  settings: {},
};

const finished = (nodeId: string, extra: Partial<NodeFinishedEvent> = {}): NodeFinishedEvent => ({
  executionId: 'e1',
  nodeId,
  runIndex: 0,
  status: 'success',
  itemsIn: 1,
  itemsOut: 1,
  durationMs: 120,
  pinned: false,
  reused: false,
  dataTruncated: false,
  data: { input: { main: [{ json: { segredo: 'x' } }] }, output: { main: [{ json: { y: 1 } }] } },
  console: ['log'],
  error: null,
  ...extra,
});

describe('spec 027 — eventos do stream', () => {
  it('FR-001/FR-002/FR-003: begin e end com o nome do nó do canvas e só metadados', () => {
    const t = new StreamTracker(definition, 'e1', () => 1_700_000_000_000);
    expect(t.queued()).toEqual({
      type: 'execution',
      metadata: { executionId: 'e1', timestamp: 1_700_000_000_000, status: 'queued' },
    });
    expect(
      t.handle('executionStarted', { executionId: 'e1', workflowId: 'wf', startedAt: '' }),
    ).toEqual([
      {
        type: 'execution',
        metadata: { executionId: 'e1', timestamp: 1_700_000_000_000, status: 'started' },
      },
    ]);
    const [begin] = t.handle('nodeStarted', {
      executionId: 'e1',
      nodeId: 'p',
      runIndex: 0,
      startedAt: '',
    });
    expect(begin).toEqual({
      type: 'begin',
      metadata: {
        executionId: 'e1',
        timestamp: 1_700_000_000_000,
        nodeId: 'p',
        nodeName: 'Planner',
        nodeType: 'ai.agentix',
        runIndex: 0,
        itemIndex: 0,
      },
    });
    // Em execução: aparece no ping.
    expect(t.ping()).toMatchObject({
      type: 'ping',
      metadata: { running: [{ nodeId: 'p', nodeName: 'Planner' }] },
    });
    const [end] = t.handle('nodeFinished', finished('p', { durationMs: 26_390 }));
    expect(end).toEqual({
      type: 'end',
      metadata: {
        executionId: 'e1',
        timestamp: 1_700_000_000_000,
        nodeId: 'p',
        nodeName: 'Planner',
        nodeType: 'ai.agentix',
        runIndex: 0,
        itemIndex: 0,
        status: 'success',
        durationMs: 26_390,
        itemsIn: 1,
        itemsOut: 1,
      },
    });
    // Nenhum dado do nó (entrada, saída, console) vai para o stream.
    expect(JSON.stringify(end)).not.toMatch(/segredo|console|"data"/);
    expect(t.ping()).toMatchObject({ metadata: { running: [] } });
    expect(t.lastDataNode).toMatchObject({ nodeName: 'Planner' });
  });

  it('FR-002: nós sem dados e eventos de outras execuções ficam fora; o nó de resposta é guardado', () => {
    const t = new StreamTracker(definition, 'e1');
    expect(t.handle('nodeFinished', finished('p', { status: 'skipped' }))).toEqual([]);
    expect(t.handle('nodeFinished', finished('p', { executionId: 'outra' }))).toEqual([]);
    expect(
      t.handle('agentStep', {
        executionId: 'e1',
        nodeId: 'p',
        runIndex: 0,
        itemIndex: 0,
        stepIndex: 0,
        kind: 'final',
        toolName: null,
        inputTokens: 0,
        outputTokens: 0,
        createdAt: '',
      }),
    ).toEqual([]);
    t.handle('nodeFinished', finished('r', { itemsOut: 1 }));
    expect(t.responderNode).toMatchObject({ nodeId: 'r', nodeName: 'Responder' });
    expect(t.final({ ok: true }, t.responderNode)).toMatchObject({
      type: 'item',
      content: { ok: true },
      metadata: { nodeName: 'Responder', final: true },
    });
    expect(t.error('falhou', 'p')).toMatchObject({
      type: 'error',
      content: 'falhou',
      metadata: { nodeId: 'p', nodeName: 'Planner' },
    });
    expect(ndjsonLine(t.waiting())).toMatch(
      /^\{"type":"execution","metadata":\{.*"status":"waiting"\}\}\n$/,
    );
  });
});
