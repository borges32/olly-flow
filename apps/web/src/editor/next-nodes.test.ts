import type { Edge, NodeOutput, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { nextNodes, type NextNodesInput } from './next-nodes';
import type { NodeRunView, RunState } from './store';

const n = (id: string, type = 'data.set'): WorkflowNode => ({
  id,
  type,
  name: id,
  params: {},
  position: [0, 0],
});
const e = (from: string, to: string, fromPort = 'main', toPort = 'main'): Edge => ({
  id: `${from}>${to}`,
  from,
  fromPort,
  to,
  toPort,
});
const view = (status: NodeRunView['status'], output?: NodeOutput, itemsOut = 0): NodeRunView => ({
  status,
  itemsIn: 0,
  itemsOut,
  pinned: false,
  reused: false,
  dataTruncated: false,
  error: null,
  ...(output && { output }),
});
const item = { json: {} };

const run = (
  nodes: WorkflowNode[],
  edges: Edge[],
  runNodes: Record<string, NodeRunView>,
  status: RunState['status'] = 'success',
) => {
  const input: NextNodesInput = {
    nodes,
    edges,
    run: { status, nodes: runNodes },
    isSubNodeEdge: (edge) => edge.toPort.startsWith('ai_'),
  };
  const result = nextNodes(input);
  return { nodes: [...result.nodeIds].sort(), edges: [...result.edgeIds].sort() };
};

// Início → Montar → If (true → Sim, false → Não)
const nodes = [n('inicio', 'trigger.manual'), n('montar'), n('if', 'logic.if'), n('sim'), n('nao')];
const edges = [
  e('inicio', 'montar'),
  e('montar', 'if'),
  e('if', 'sim', 'true'),
  e('if', 'nao', 'false'),
];

describe('nextNodes (spec 024)', () => {
  it('FR-001: o nó seguinte ao último executado é o próximo, com a conexão até ele', () => {
    expect(
      run(nodes, edges, {
        inicio: view('success', { main: [item] }),
        montar: view('success', { main: [item] }),
      }),
    ).toEqual({ nodes: ['if'], edges: ['montar>if'] });
  });

  it('FR-002/SC-001: depois do If, só o ramo com itens; executado o ramo, nada mais', () => {
    const base = {
      inicio: view('success', { main: [item] }),
      montar: view('success', { main: [item] }),
      if: view('success', { true: [item], false: [] }),
    };
    expect(run(nodes, edges, base)).toEqual({ nodes: ['sim'], edges: ['if>sim'] });
    expect(run(nodes, edges, { ...base, sim: view('success', { main: [item] }) }).nodes).toEqual(
      [],
    );
  });

  it('FR-002: saída de erro com itens leva ao próximo; nó com erro não tem próximo', () => {
    const withError = [...nodes, n('trata')];
    const edgesError = [...edges, e('montar', 'trata', 'error')];
    expect(
      run(withError, edgesError, {
        inicio: view('success', { main: [item] }),
        montar: view('success', { main: [], error: [item] }),
      }).nodes,
    ).toEqual(['trata']);
    expect(
      run(nodes, edges, {
        inicio: view('success', { main: [item] }),
        montar: view('error'),
      }).nodes,
    ).toEqual([]);
  });

  it('FR-002: sub-nós não são destacados', () => {
    const ai = [n('chat', 'trigger.manual'), n('agent', 'ai.agent'), n('modelo', 'ai.model')];
    const aiEdges = [
      e('chat', 'agent'),
      e('modelo', 'agent', 'ai_languageModel', 'ai_languageModel'),
    ];
    expect(
      run(ai, aiEdges, {
        chat: view('success', { main: [item] }),
        modelo: view('success', { ai_languageModel: [item] }),
      }),
    ).toEqual({ nodes: ['agent'], edges: ['chat>agent'] });
  });

  it('FR-001: Merge com uma entrada com itens já é o próximo; "sem dados" antigo conta como pendente', () => {
    const merge = [n('a', 'trigger.manual'), n('b'), n('c'), n('merge', 'logic.merge')];
    const mergeEdges = [
      e('a', 'b'),
      e('a', 'c'),
      e('b', 'merge', 'main', 'input1'),
      e('c', 'merge', 'main', 'input2'),
    ];
    expect(
      run(merge, mergeEdges, {
        a: view('success', { main: [item] }),
        b: view('success', { main: [item] }),
        c: view('skipped'),
        merge: view('skipped'),
      }),
    ).toEqual({ nodes: ['c', 'merge'], edges: ['a>c', 'b>merge'] });
  });

  it('FR-001: sem os dados (sem execution:readData), vale a contagem de itens', () => {
    expect(
      run(nodes, edges, {
        inicio: view('success', undefined, 1),
        montar: view('success', undefined, 1),
        if: view('success', undefined, 1),
      }).nodes,
    ).toEqual(['nao', 'sim']);
    expect(
      run(nodes, edges, {
        inicio: view('success', undefined, 1),
        montar: view('success', undefined, 0),
      }).nodes,
    ).toEqual([]);
  });

  it('FR-003: sem destaque durante a execução e sem execução', () => {
    const runNodes = { inicio: view('success', { main: [item] }) };
    expect(run(nodes, edges, runNodes, 'running').nodes).toEqual([]);
    expect(run(nodes, edges, {}, 'idle').nodes).toEqual([]);
    expect(run(nodes, edges, runNodes, 'error').nodes).toEqual(['montar']);
  });
});
