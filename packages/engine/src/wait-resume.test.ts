import { IsolateEvaluator } from '@olly/expressions/isolate';
import { NodeWaitSignal, builtinNodes, createNodeRegistry, type NodeDefinition } from '@olly/nodes';
import type { Edge, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { afterAll, describe, expect, it } from 'vitest';
import { runWorkflow, type EngineSnapshot, type NodeRunRecord, type RunResult } from './run.js';

const evaluator = new IsolateEvaluator({ timeoutMs: 2000 });
afterAll(() => {
  evaluator.disposeAll();
});

/** Nó de teste que pausa até ser retomado e então marca os itens com o que recebeu. */
const pauseNode: NodeDefinition = {
  type: 'test.pause',
  version: 1,
  displayName: 'Pausa',
  description: 'Pausa até a retomada',
  icon: 'hourglass',
  category: 'flow',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: { type: 'object', properties: {} },
  execute: (input, ctx) => {
    ctx.setVariable(`antes_${String(ctx.runIndex)}`, true);
    if (!ctx.resume) {
      return Promise.reject(
        new NodeWaitSignal({ reason: 'aguardando', data: { visto: input.items.length } }),
      );
    }
    return Promise.resolve({
      main: input.items.map((item, i) => ({
        json: { ...item.json, retomado: ctx.resume?.value, dados: ctx.resume?.data },
        pairedItem: { item: i },
      })),
    });
  },
};

const registry = createNodeRegistry([...builtinNodes, pauseNode]);

const node = (id: string, type: string, params: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type,
  name: id,
  params,
  position: [0, 0],
});
const set = (id: string, name: string, value: string) =>
  node(id, 'data.set', {
    fields: [{ name, type: 'string', value }],
    includeOtherFields: true,
  });
const e = (from: string, to: string, fromPort = 'main', toPort = 'main'): Edge => ({
  id: `${from}.${fromPort}-${to}.${toPort}`,
  from,
  fromPort,
  to,
  toPort,
});
const def = (nodes: WorkflowNode[], edges: Edge[]): WorkflowDefinition => ({
  nodes,
  edges,
  settings: {},
});

/** Persiste como a API faria (JSON) antes de retomar. */
const roundTrip = (snapshot: EngineSnapshot | undefined) =>
  JSON.parse(JSON.stringify(snapshot)) as EngineSnapshot;

describe('spec 008 — FR-012: espera e retomada no motor', () => {
  it('FR-012: o nó em espera pausa a execução; ramos independentes terminam; a retomada continua', async () => {
    const definition = def(
      [
        node('m', 'trigger.manual'),
        set('a', 'a', '1'),
        node('p', 'test.pause'),
        set('depois', 'depois', '={{ $json.a }}-ok'),
        set('outro', 'outro', 'sim'),
      ],
      [e('m', 'a'), e('a', 'p'), e('p', 'depois'), e('m', 'outro')],
    );
    const records: NodeRunRecord[] = [];
    const first = await runWorkflow(definition, registry, {
      evaluator,
      triggerItems: [{ json: { x: 1 } }],
      callbacks: { onNodeFinish: (r) => void records.push(r) },
    });
    expect(first.status).toBe('waiting');
    expect(first.waiting).toEqual([
      { nodeId: 'p', runIndex: 0, request: { reason: 'aguardando', data: { visto: 1 } } },
    ]);
    expect(first.nodes.p?.status).toBe('waiting');
    expect(first.nodes.depois?.status).toBe('pending');
    // O ramo que não depende da espera terminou.
    expect(first.nodes.outro?.output?.main?.[0]?.json).toMatchObject({ outro: 'sim' });
    expect(records.find((r) => r.nodeId === 'p')?.status).toBe('waiting');
    expect(first.vars).toEqual({ antes_0: true });

    const second = await runWorkflow(definition, registry, {
      evaluator,
      resume: { snapshot: roundTrip(first.snapshot), values: { p: { kind: 'time' } } },
      callbacks: { onNodeFinish: (r) => void records.push(r) },
    });
    expect(second.status).toBe('success');
    expect(second.nodes.depois?.output?.main?.[0]?.json).toEqual({
      x: 1,
      a: '1',
      retomado: { kind: 'time' },
      dados: { visto: 1 },
      depois: '1-ok',
    });
    // A mesma execução do nó termina (mesmo runIndex) e as variáveis foram mantidas.
    const pRecords = records.filter((r) => r.nodeId === 'p');
    expect(pRecords.map((r) => [r.status, r.runIndex])).toEqual([
      ['waiting', 0],
      ['success', 0],
    ]);
    expect(second.vars).toEqual({ antes_0: true });
    // Nós que já tinham terminado não executam de novo.
    expect(records.filter((r) => r.nodeId === 'outro')).toHaveLength(1);
  });

  it('FR-012: sem valor para o nó, a retomada mantém a espera', async () => {
    const definition = def([node('m', 'trigger.manual'), node('p', 'test.pause')], [e('m', 'p')]);
    const first = await runWorkflow(definition, registry, { evaluator });
    const again = await runWorkflow(definition, registry, {
      evaluator,
      resume: { snapshot: roundTrip(first.snapshot), values: {} },
    });
    expect(again.status).toBe('waiting');
    expect(again.waiting?.map((w) => w.nodeId)).toEqual(['p']);
  });

  it('FR-012/risco do plano: espera dentro de um laço retoma na iteração certa', async () => {
    const definition = def(
      [
        node('m', 'trigger.manual'),
        node('lote', 'logic.loopOverItems', { batchSize: 1 }),
        node('p', 'test.pause'),
        set('fim', 'fim', 'ok'),
      ],
      [
        e('m', 'lote'),
        e('lote', 'p', 'loop'),
        e('p', 'lote', 'main', 'continue'),
        e('lote', 'fim', 'done'),
      ],
    );
    let result: RunResult = await runWorkflow(definition, registry, {
      evaluator,
      triggerItems: [{ json: { id: 1 } }, { json: { id: 2 } }],
    });
    const pauses: number[] = [];
    while (result.status === 'waiting') {
      pauses.push(result.waiting?.[0]?.runIndex ?? -1);
      result = await runWorkflow(definition, registry, {
        evaluator,
        resume: { snapshot: roundTrip(result.snapshot), values: { p: 'ok' } },
      });
    }
    expect(result.status).toBe('success');
    // Uma pausa por volta do laço, com o índice da iteração.
    expect(pauses).toEqual([0, 1]);
    expect(result.nodes.fim?.output?.main?.map((i) => i.json)).toEqual([
      { id: 1, retomado: 'ok', dados: { visto: 1 }, fim: 'ok' },
      { id: 2, retomado: 'ok', dados: { visto: 1 }, fim: 'ok' },
    ]);
  });

  it('FR-012: a espera não usa retry nem onError', async () => {
    const definition = def(
      [
        node('m', 'trigger.manual'),
        {
          ...node('p', 'test.pause'),
          settings: { retry: { maxTries: 3, waitMs: 0 }, onError: 'continue' },
        },
      ],
      [e('m', 'p')],
    );
    const result = await runWorkflow(definition, registry, { evaluator });
    expect(result.status).toBe('waiting');
  });

  it('FR-012: o Esperar de 2 min pausa e, retomado, segue', async () => {
    const definition = def(
      [
        node('m', 'trigger.manual'),
        node('w', 'flow.wait', { resume: 'timeInterval', amount: 2, unit: 'minutes' }),
        set('s', 's', 'depois'),
      ],
      [e('m', 'w'), e('w', 's')],
    );
    const first = await runWorkflow(definition, registry, { evaluator });
    expect(first.status).toBe('waiting');
    const resumeAt = Date.parse(first.waiting?.[0]?.request.resumeAt ?? '');
    expect(resumeAt - Date.now()).toBeGreaterThan(100_000);
    const done = await runWorkflow(definition, registry, {
      evaluator,
      resume: { snapshot: roundTrip(first.snapshot), values: { w: { kind: 'time' } } },
    });
    expect(done.status).toBe('success');
    expect(done.nodes.s?.output?.main?.[0]?.json).toEqual({ s: 'depois' });
  });
});
