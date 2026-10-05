import {
  NodeRegistry,
  createNodeRegistry,
  manualTrigger,
  setNode,
  type NodeDefinition,
} from '@olly/nodes';
import type { Edge, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionState } from './state.js';
import { WorkflowRunError, runWorkflow } from './run.js';

const registry = createNodeRegistry();

const manual = (id = 'm'): WorkflowNode => ({
  id,
  type: 'trigger.manual',
  name: id,
  params: {},
  position: [0, 0],
});
// includeOtherFields: o padrão mudou para falso na spec 003 (como no N8N); estes testes acumulam campos.
const setFields = (
  id: string,
  fields: unknown[],
  extra: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id,
  type: 'data.set',
  name: id,
  params: { fields, includeOtherFields: true },
  position: [0, 0],
  ...extra,
});
const edge = (from: string, to: string, fromPort = 'main', toPort = 'main'): Edge => ({
  id: `${from}-${to}`,
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

describe('spec 002 — FR-016/SC-005: motor sequencial', () => {
  it('SC-005: executa Manual → Set com campo aninhado e produz os itens esperados', async () => {
    const result = await runWorkflow(
      def(
        [manual(), setFields('s', [{ name: 'cliente.nome', type: 'string', value: 'Ana' }])],
        [edge('m', 's')],
      ),
      registry,
    );
    expect(result.status).toBe('success');
    expect(result.nodes.s).toEqual({
      status: 'success',
      output: { main: [{ json: { cliente: { nome: 'Ana' } }, pairedItem: { item: 0 } }] },
    });
  });

  it('FR-016/FR-017: entrega os itens do gatilho e propaga em ordem topológica', async () => {
    const order: string[] = [];
    const result = await runWorkflow(
      def(
        [
          setFields('b', [{ name: 'b', type: 'number', value: '2' }]),
          manual(),
          setFields('a', [{ name: 'a', type: 'number', value: '1' }]),
        ],
        [edge('m', 'a'), edge('a', 'b')],
      ),
      registry,
      {
        triggerItems: [{ json: { id: 1 } }, { json: { id: 2 } }],
        callbacks: { onNodeStart: (id) => void order.push(id) },
      },
    );
    expect(order).toEqual(['m', 'a', 'b']);
    expect(result.nodes.b?.output?.main?.map((i) => i.json)).toEqual([
      { id: 1, a: 1, b: 2 },
      { id: 2, a: 1, b: 2 },
    ]);
  });

  it('FR-016: nó desabilitado repassa a entrada sem executar', async () => {
    const result = await runWorkflow(
      def(
        [
          manual(),
          setFields('off', [{ name: 'x', type: 'number', value: '1' }], { disabled: true }),
          setFields('s', [{ name: 'y', type: 'number', value: '2' }]),
        ],
        [edge('m', 'off'), edge('off', 's')],
      ),
      registry,
      { triggerItems: [{ json: { id: 1 } }] },
    );
    // O repasse é 1:1: o pairedItem é preenchido para a cadeia de itens atravessar o nó (spec 003).
    expect(result.nodes.off?.output).toEqual({
      main: [{ json: { id: 1 }, pairedItem: { item: 0 } }],
    });
    expect(result.nodes.s?.output?.main?.[0]?.json).toEqual({ id: 1, y: 2 });
  });

  it('FR-016: ramificação entrega cópias independentes a cada destino', async () => {
    const result = await runWorkflow(
      def(
        [
          manual(),
          setFields('a', [{ name: 'obj.a', type: 'number', value: '1' }]),
          setFields('b', [{ name: 'obj.b', type: 'number', value: '2' }]),
        ],
        [edge('m', 'a'), edge('m', 'b')],
      ),
      registry,
      { triggerItems: [{ json: { obj: {} } }] },
    );
    expect(result.nodes.a?.output?.main?.[0]?.json).toEqual({ obj: { a: 1 } });
    expect(result.nodes.b?.output?.main?.[0]?.json).toEqual({ obj: { b: 2 } });
  });

  it('FR-016: ramo sem itens não executa os nós seguintes', async () => {
    const empty: NodeDefinition = {
      ...setNode,
      type: 'data.empty',
      execute: () => Promise.resolve({ main: [] }),
    };
    const custom = new NodeRegistry();
    for (const n of [manualTrigger, setNode, empty]) custom.register(n);
    const execute = vi.spyOn(setNode, 'execute');
    const result = await runWorkflow(
      def(
        [manual(), { ...setFields('e', []), type: 'data.empty' }, setFields('s', [])],
        [edge('m', 'e'), edge('e', 's')],
      ),
      custom,
    );
    expect(result.nodes.s?.status).toBe('skipped');
    expect(execute).not.toHaveBeenCalled();
    execute.mockRestore();
  });

  it('FR-016: nós não alcançáveis a partir do gatilho não executam', async () => {
    const result = await runWorkflow(def([manual(), setFields('solto', [])], []), registry);
    expect(result.nodes).not.toHaveProperty('solto');
  });

  it('FR-016: erro em um nó interrompe a execução e é reportado', async () => {
    const onNodeError = vi.fn();
    const result = await runWorkflow(
      def(
        [
          manual(),
          setFields('ruim', [{ name: 'n', type: 'number', value: 'abc' }]),
          setFields('depois', []),
        ],
        [edge('m', 'ruim'), edge('ruim', 'depois')],
      ),
      registry,
      { callbacks: { onNodeError } },
    );
    expect(result.status).toBe('error');
    expect(result.error).toEqual({
      nodeId: 'ruim',
      message: expect.stringContaining('não é um número') as unknown,
    });
    expect(result.nodes.depois?.status).toBe('pending');
    expect(onNodeError).toHaveBeenCalledOnce();
  });

  it('FR-016: chama os callbacks do ciclo de vida', async () => {
    const calls: string[] = [];
    await runWorkflow(def([manual()], []), registry, {
      callbacks: {
        onNodeStart: (id) => void calls.push(`start:${id}`),
        onNodeSuccess: (id) => void calls.push(`ok:${id}`),
        onExecutionFinish: (r) => void calls.push(`fim:${r.status}`),
      },
    });
    expect(calls).toEqual(['start:m', 'ok:m', 'fim:success']);
  });

  it('FR-016: recusa workflow com ciclo, sem gatilho ou com gatilhos ambíguos', async () => {
    await expect(
      runWorkflow(def([manual(), setFields('a', [])], [edge('m', 'a'), edge('a', 'a')]), registry),
    ).rejects.toThrow(WorkflowRunError);
    await expect(runWorkflow(def([setFields('a', [])], []), registry)).rejects.toThrow(
      'não tem gatilho',
    );
    await expect(runWorkflow(def([manual('m1'), manual('m2')], []), registry)).rejects.toThrow(
      'mais de um gatilho',
    );
    const ok = await runWorkflow(def([manual('m1'), manual('m2')], []), registry, {
      startNodeId: 'm2',
    });
    expect(Object.keys(ok.nodes)).toEqual(['m2']);
  });
});

describe('spec 002 — FR-016: ExecutionState', () => {
  it('FR-016: nó fica pronto só quando todas as fontes terminaram', () => {
    const state = new ExecutionState(
      def([manual('a'), manual('b'), setFields('c', [])], [edge('a', 'c'), edge('b', 'c')]),
    );
    expect(state.isReady('c')).toBe(false);
    state.get('a').status = 'success';
    expect(state.isReady('c')).toBe(false);
    state.get('b').status = 'skipped';
    expect(state.isReady('c')).toBe(true);
  });

  it('FR-016/FR-008 (spec 006): a entrada segue a ordem das arestas, não a de conclusão', () => {
    const state = new ExecutionState(
      def([manual('a'), manual('b'), setFields('c', [])], [edge('a', 'c'), edge('b', 'c')]),
    );
    // `b` termina antes de `a`.
    Object.assign(state.get('b'), { status: 'success', output: { main: [{ json: { x: 2 } }] } });
    Object.assign(state.get('a'), { status: 'success', output: { main: [{ json: { x: 1 } }] } });
    state.collect('c');
    expect(state.get('c').inputs.main?.map((i) => i.json)).toEqual([{ x: 1 }, { x: 2 }]);
    expect(state.get('c').sources.main).toEqual([
      { nodeId: 'a', port: 'main', index: 0 },
      { nodeId: 'b', port: 'main', index: 0 },
    ]);
  });
});
