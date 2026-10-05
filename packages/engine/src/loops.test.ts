import { IsolateEvaluator } from '@olly/expressions/isolate';
import { createNodeRegistry } from '@olly/nodes';
import type { Edge, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ExecutionCancelledError,
  WorkflowRunError,
  runWorkflow,
  type NodeRunRecord,
} from './run.js';

const evaluator = new IsolateEvaluator({ timeoutMs: 2000 });
const registry = createNodeRegistry();
afterAll(() => {
  evaluator.disposeAll();
});

const node = (id: string, type: string, params: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type,
  name: id,
  params,
  position: [0, 0],
});
const set = (id: string, fields: [string, string, string][]) =>
  node(id, 'data.set', {
    fields: fields.map(([name, type, value]) => ({ name, type, value })),
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
const loop = (id: string, condition: string, extra: Record<string, unknown> = {}) =>
  node(id, 'logic.while', { condition, ...extra });

describe('spec 007 — FR-008/FR-009: laços no motor', () => {
  it('FR-009: cada iteração é registrada com o próprio runIndex', async () => {
    const records: NodeRunRecord[] = [];
    await runWorkflow(
      def(
        [
          node('m', 'trigger.manual'),
          loop('w', '={{ $loop.index < 3 }}'),
          set('b', [['v', 'number', '={{ $loop.index }}']]),
        ],
        [e('m', 'w'), e('w', 'b', 'loop'), e('b', 'w', 'main', 'continue')],
      ),
      registry,
      { evaluator, callbacks: { onNodeFinish: (r) => void records.push(r) } },
    );
    expect(
      records.filter((r) => r.nodeId === 'b').map((r) => [r.runIndex, r.output?.main?.[0]?.json.v]),
    ).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(records.filter((r) => r.nodeId === 'w').map((r) => r.runIndex)).toEqual([0, 1, 2, 3]);
  });

  it('FR-008: laços aninhados: o interno recomeça a cada volta do externo', async () => {
    const records: NodeRunRecord[] = [];
    const result = await runWorkflow(
      def(
        [
          node('m', 'trigger.manual'),
          loop('externo', '={{ $loop.index < 2 }}'),
          loop('interno', '={{ $loop.index < 3 }}'),
          set('x', [['ok', 'boolean', 'true']]),
          set('fim', []),
        ],
        [
          e('m', 'externo'),
          e('externo', 'interno', 'loop'),
          e('interno', 'x', 'loop'),
          e('x', 'interno', 'main', 'continue'),
          e('interno', 'externo', 'done', 'continue'),
          e('externo', 'fim', 'done'),
        ],
      ),
      registry,
      { evaluator, callbacks: { onNodeFinish: (r) => void records.push(r) } },
    );
    expect(result.status).toBe('success');
    expect(records.filter((r) => r.nodeId === 'x')).toHaveLength(6);
    expect(result.nodes.fim?.status).toBe('success');
  });

  it('FR-008: ciclo inválido é recusado antes de executar', async () => {
    await expect(
      runWorkflow(
        def(
          [node('m', 'trigger.manual'), set('a', []), set('b', [])],
          [e('m', 'a'), e('a', 'b'), e('b', 'a')],
        ),
        registry,
        { evaluator },
      ),
    ).rejects.toThrow(WorkflowRunError);
  });

  it('NFR-001: o teto global de iterações vale mesmo com limite maior no nó', async () => {
    const result = await runWorkflow(
      def(
        [
          node('m', 'trigger.manual'),
          loop('w', '={{ true }}', { maxIterations: 10_000 }),
          set('b', []),
        ],
        [e('m', 'w'), e('w', 'b', 'loop'), e('b', 'w', 'main', 'continue')],
      ),
      registry,
      { evaluator, maxLoopIterations: 5 },
    );
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('5 iterações');
  });

  it('FR-007: nó fora do laço só executa depois do fim e vê a última iteração', async () => {
    const result = await runWorkflow(
      def(
        [
          node('m', 'trigger.manual'),
          loop('w', '={{ $loop.index < 4 }}'),
          set('corpo', [['volta', 'number', '={{ $loop.index }}']]),
          set('depois', [['viu', 'number', "={{ $('corpo').last().json.volta }}"]]),
        ],
        [
          e('m', 'w'),
          e('w', 'corpo', 'loop'),
          e('corpo', 'w', 'main', 'continue'),
          e('corpo', 'depois'),
        ],
      ),
      registry,
      { evaluator },
    );
    expect(result.nodes.depois?.output?.main?.[0]?.json).toMatchObject({ viu: 3 });
  });

  it('FR-010 (spec 006) com laços: cancelar no meio interrompe o laço', async () => {
    const controller = new AbortController();
    let started = 0;
    const result = await runWorkflow(
      def(
        [
          node('m', 'trigger.manual'),
          loop('w', '={{ true }}', { maxIterations: 10_000 }),
          set('b', []),
        ],
        [e('m', 'w'), e('w', 'b', 'loop'), e('b', 'w', 'main', 'continue')],
      ),
      registry,
      {
        evaluator,
        signal: controller.signal,
        callbacks: {
          onNodeStart: () => {
            if (++started === 20)
              controller.abort(new ExecutionCancelledError('cancelled', 'parou'));
          },
        },
      },
    );
    expect(result.status).toBe('cancelled');
  });
});
