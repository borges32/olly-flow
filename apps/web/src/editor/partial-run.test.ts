import type { Edge, Item, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { downstreamOf, nodeSignature, planReuse } from './partial-run';
import type { NodeRunView } from './store';

const node = (id: string, params: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type: 'data.set',
  name: id.toUpperCase(),
  params,
  position: [0, 0],
});
const edge = (from: string, to: string): Edge => ({
  id: `${from}-${to}`,
  from,
  fromPort: 'main',
  to,
  toPort: 'main',
});

// m → a → b → c
const nodes = ['m', 'a', 'b', 'c'].map((id) => node(id));
const edges = [edge('m', 'a'), edge('a', 'b'), edge('b', 'c')];

/** Estado de execução em que todos os nós rodaram com a definição indicada. */
function ranWith(
  ns: WorkflowNode[],
  es: Edge[],
  pinData: Record<string, Item[]> = {},
  overrides: Record<string, Partial<NodeRunView>> = {},
): Record<string, NodeRunView> {
  return Object.fromEntries(
    ns.map((n) => [
      n.id,
      {
        status: 'success',
        itemsIn: 1,
        itemsOut: 1,
        pinned: false,
        reused: false,
        dataTruncated: false,
        error: null,
        executionId: 'exec-1',
        signature: nodeSignature(n, es, pinData),
        ...overrides[n.id],
      },
    ]),
  );
}

describe('spec 003 — FR-020: plano de reaproveitamento ao executar um nó', () => {
  it('FR-020: reaproveita todos os anteriores sem alteração; o destino nunca', () => {
    expect(planReuse('c', nodes, edges, {}, ranWith(nodes, edges))).toEqual({
      m: 'exec-1',
      a: 'exec-1',
      b: 'exec-1',
    });
  });

  it('FR-020: cada nó aponta para a execução que produziu os dados dele', () => {
    const run = ranWith(nodes, edges, {}, { b: { executionId: 'exec-2' } });
    expect(planReuse('c', nodes, edges, {}, run)).toMatchObject({ a: 'exec-1', b: 'exec-2' });
  });

  it('FR-020: nó alterado depois da execução executa de novo, e os seguintes também', () => {
    const run = ranWith(nodes, edges);
    const changed = nodes.map((n) => (n.id === 'a' ? node('a', { x: 1 }) : n));
    expect(planReuse('c', changed, edges, {}, run)).toEqual({ m: 'exec-1' });
  });

  it('FR-020: nova conexão de entrada ou pin alterado invalidam o nó', () => {
    const run = ranWith(nodes, edges);
    expect(planReuse('c', nodes, [...edges, edge('m', 'b')], {}, run)).toEqual({
      m: 'exec-1',
      a: 'exec-1',
    });
    expect(planReuse('c', nodes, edges, { a: [{ json: { novo: true } }] }, run)).toEqual({
      m: 'exec-1',
    });
  });

  it('FR-020: dados truncados, erro ou nó sem execução não são reaproveitados', () => {
    const run = ranWith(nodes, edges, {}, { b: { dataTruncated: true } });
    expect(planReuse('c', nodes, edges, {}, run)).toEqual({ m: 'exec-1', a: 'exec-1' });
    const failed = ranWith(nodes, edges, {}, { a: { status: 'error' } });
    expect(planReuse('c', nodes, edges, {}, failed)).toEqual({ m: 'exec-1' });
    const withoutB = ranWith(nodes, edges);
    delete withoutB.b;
    expect(planReuse('c', nodes, edges, {}, withoutB)).toEqual({ m: 'exec-1', a: 'exec-1' });
  });

  it('FR-020: só ancestrais do destino entram no plano', () => {
    const extra = [...nodes, node('x')];
    const es = [...edges, edge('m', 'x')];
    expect(Object.keys(planReuse('a', extra, es, {}, ranWith(extra, es)))).toEqual(['m']);
  });

  it('FR-020: downstreamOf inclui o nó e todos os que dependem dele', () => {
    expect([...downstreamOf('a', [...edges, edge('m', 'x')])].sort()).toEqual(['a', 'b', 'c']);
  });
});
