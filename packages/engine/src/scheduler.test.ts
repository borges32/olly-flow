import { createNodeRegistry, manualTrigger, setNode, type NodeDefinition } from '@olly/nodes';
import type { Edge, Item, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { ExecutionCancelledError, runWorkflow } from './run.js';

/** Nó de teste: espera `ms` (respeitando o sinal) e devolve a entrada com o próprio nome. */
const sleepNode: NodeDefinition = {
  type: 'test.sleep',
  version: 1,
  displayName: 'Espera',
  description: '',
  icon: 'clock',
  category: 'data',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: { type: 'object' },
  supportsParallelItems: true,
  async execute({ items }, ctx) {
    const ms = Number(ctx.node.params.ms ?? 0);
    const out = await ctx.mapItems(items.length > 0 ? items : [{ json: {} }], async (item, i) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        ctx.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('abortado'));
        });
      });
      return { json: { ...item.json, [ctx.node.name]: i } } satisfies Item;
    });
    return { main: out };
  },
};
const registry = createNodeRegistry([manualTrigger, setNode, sleepNode]);
const node = (id: string, type: string, params: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type,
  name: id,
  params,
  position: [0, 0],
});
const sleep = (id: string, ms: number, extra: Partial<WorkflowNode> = {}) => ({
  ...node(id, 'test.sleep', { ms }),
  ...extra,
});
const edge = (from: string, to: string): Edge => ({
  id: `${from}-${to}`,
  from,
  fromPort: 'main',
  to,
  toPort: 'main',
});
const def = (
  nodes: WorkflowNode[],
  edges: Edge[],
  settings: WorkflowDefinition['settings'] = {},
): WorkflowDefinition => ({ nodes, edges, settings });

/** Manual → 3 ramos de `ms` → junção. */
const fanOut = (ms: number[], settings: WorkflowDefinition['settings'] = {}) =>
  def(
    [
      node('m', 'trigger.manual'),
      ...ms.map((t, i) => sleep(`r${i}`, t)),
      node('junta', 'data.set', { fields: [], includeOtherFields: true }),
    ],
    [...ms.map((_, i) => edge('m', `r${i}`)), ...ms.map((_, i) => edge(`r${i}`, 'junta'))],
    settings,
  );

describe('spec 006 — FR-006/FR-008: agendador de DAG concorrente', () => {
  it('FR-006: ramos independentes rodam ao mesmo tempo (3 × 200 ms ≈ 200 ms)', async () => {
    const t0 = Date.now();
    const result = await runWorkflow(fanOut([200, 200, 200], { maxParallel: 8 }), registry);
    const elapsed = Date.now() - t0;
    expect(result.status).toBe('success');
    expect(elapsed).toBeLessThan(450);
  });

  it('FR-006: maxParallel = 1 reproduz a execução sequencial', async () => {
    const t0 = Date.now();
    await runWorkflow(fanOut([100, 100, 100], { maxParallel: 1 }), registry);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(290);
  });

  it('FR-006: respeita o limite de paralelismo do workflow', async () => {
    let active = 0;
    let peak = 0;
    const result = await runWorkflow(fanOut([60, 60, 60, 60, 60], { maxParallel: 2 }), registry, {
      callbacks: {
        onNodeStart: (id) => {
          if (id.startsWith('r')) peak = Math.max(peak, ++active);
        },
        onNodeFinish: (r) => {
          if (r.nodeId.startsWith('r')) active--;
        },
      },
    });
    expect(result.status).toBe('success');
    expect(peak).toBe(2);
  });

  it('FR-008/SC-002: a saída é a mesma em 20 execuções, qualquer que seja a ordem de conclusão', async () => {
    const outputs = new Set<string>();
    for (let run = 0; run < 20; run++) {
      // Durações sorteadas: a ordem de conclusão muda a cada execução.
      const ms = [0, 1, 2].map(() => Math.floor(Math.random() * 15));
      const result = await runWorkflow(fanOut(ms, { maxParallel: 8 }), registry);
      outputs.add(JSON.stringify(result.nodes.junta?.output));
    }
    expect(outputs.size).toBe(1);
    const [only] = [...outputs];
    // Concatenação na ordem das arestas: r0, r1, r2.
    expect(
      (JSON.parse(only ?? '{}') as { main: Item[] }).main.map((i) => Object.keys(i.json)),
    ).toEqual([['r0'], ['r1'], ['r2']]);
  });

  it('FR-008: com erros em dois ramos, vale o primeiro na ordem topológica', async () => {
    const failing = (id: string, ms: number) => node(id, 'test.sleep', { ms, fail: true });
    const failReg = createNodeRegistry([
      manualTrigger,
      {
        ...sleepNode,
        async execute(input, ctx) {
          await sleepNode.execute(input, ctx);
          throw new Error(`falhou ${ctx.node.name}`);
        },
      },
    ]);
    const result = await runWorkflow(
      def(
        [node('m', 'trigger.manual'), failing('a', 40), failing('b', 1)],
        [edge('m', 'a'), edge('m', 'b')],
        { maxParallel: 8 },
      ),
      failReg,
    );
    expect(result.status).toBe('error');
    expect(result.error).toEqual({ nodeId: 'a', message: 'falhou a' });
    // O ramo que estava em andamento terminou e foi registrado.
    expect(result.nodes.b?.status).toBe('error');
  });

  it('FR-006: no primeiro erro, nenhum nó novo começa', async () => {
    const reg = createNodeRegistry([
      manualTrigger,
      setNode,
      sleepNode,
      {
        ...sleepNode,
        type: 'test.fail',
        execute: () => Promise.reject(new Error('quebrou')),
      },
    ]);
    const result = await runWorkflow(
      def(
        [
          node('m', 'trigger.manual'),
          node('x', 'test.fail'),
          sleep('lento', 50),
          sleep('depois', 0),
        ],
        [edge('m', 'x'), edge('m', 'lento'), edge('lento', 'depois')],
        { maxParallel: 8 },
      ),
      reg,
    );
    expect(result.status).toBe('error');
    expect(result.nodes.lento?.status).toBe('success');
    expect(result.nodes.depois?.status).toBe('pending');
  });
});

describe('spec 006 — FR-009: itens em paralelo', () => {
  it('FR-009: concorrência configurável e ordem preservada', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ json: { i } }));
    const t0 = Date.now();
    const result = await runWorkflow(
      def(
        [
          node('m', 'trigger.manual'),
          sleep('p', 100, { settings: { parallelItems: { enabled: true, concurrency: 5 } } }),
        ],
        [edge('m', 'p')],
      ),
      registry,
      { triggerItems: items },
    );
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(450);
    expect(result.nodes.p?.output?.main?.map((i) => i.json.i)).toEqual(items.map((i) => i.json.i));
  });

  it('FR-009: desligado, os itens são processados um por vez', async () => {
    const items = Array.from({ length: 4 }, (_, i) => ({ json: { i } }));
    const t0 = Date.now();
    await runWorkflow(
      def([node('m', 'trigger.manual'), sleep('p', 50)], [edge('m', 'p')]),
      registry,
      { triggerItems: items },
    );
    expect(Date.now() - t0).toBeGreaterThanOrEqual(195);
  });
});

describe('spec 006 — FR-010/FR-011: cancelamento pelo sinal', () => {
  it('FR-010: abortar interrompe os nós em andamento e encerra como cancelled', async () => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(new ExecutionCancelledError('cancelled', 'Execução cancelada por Ana'));
    }, 50);
    const t0 = Date.now();
    const result = await runWorkflow(fanOut([5000, 5000, 5000], { maxParallel: 8 }), registry, {
      signal: controller.signal,
    });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(result.status).toBe('cancelled');
    expect(result.error).toEqual({ message: 'Execução cancelada por Ana', reason: 'cancelled' });
    expect(['r0', 'r1', 'r2'].map((id) => result.nodes[id]?.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    expect(result.nodes.junta?.status).toBe('pending');
  });

  it('FR-011: o motivo timeout chega ao resultado', async () => {
    const result = await runWorkflow(fanOut([5000]), registry, {
      signal: AbortSignal.any([
        (() => {
          const c = new AbortController();
          setTimeout(() => {
            c.abort(new ExecutionCancelledError('timeout', 'Tempo limite da execução excedido'));
          }, 30);
          return c.signal;
        })(),
      ]),
    });
    expect(result.status).toBe('cancelled');
    expect(result.error?.reason).toBe('timeout');
  });
});
