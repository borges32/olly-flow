import type { WorkflowDefinition, WorkflowDiff } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { describePatch, diffCanvas, valueAt } from './version-diff';

const from: WorkflowDefinition = {
  nodes: [
    { id: 'a', type: 'trigger.manual', name: 'A', params: {}, position: [0, 0] },
    { id: 'b', type: 'data.set', name: 'B', params: { x: 1 }, position: [200, 0] },
    { id: 'old', type: 'data.set', name: 'Velho', params: {}, position: [400, 0] },
  ],
  edges: [
    { id: 'e1', from: 'a', fromPort: 'main', to: 'b', toPort: 'main' },
    { id: 'e2', from: 'b', fromPort: 'main', to: 'old', toPort: 'main' },
  ],
  settings: {},
};
const to: WorkflowDefinition = {
  nodes: [
    { id: 'a', type: 'trigger.manual', name: 'A', params: {}, position: [0, 0] },
    { id: 'b', type: 'data.set', name: 'B', params: { x: 2 }, position: [200, 0] },
    { id: 'new', type: 'data.set', name: 'Novo', params: {}, position: [400, 100] },
  ],
  edges: [
    { id: 'e1', from: 'a', fromPort: 'main', to: 'b', toPort: 'main' },
    { id: 'e3', from: 'b', fromPort: 'main', to: 'new', toPort: 'main' },
  ],
  settings: {},
};
const diff: WorkflowDiff = {
  from: 1,
  to: 2,
  nodes: {
    added: [to.nodes[2] as WorkflowDefinition['nodes'][number]],
    removed: [from.nodes[2] as WorkflowDefinition['nodes'][number]],
    changed: [
      {
        id: 'b',
        name: 'B',
        params: [{ op: 'replace', path: '/x', value: 2 }],
        settings: [],
        other: [],
      },
    ],
  },
  edges: {
    added: [to.edges[1] as WorkflowDefinition['edges'][number]],
    removed: [from.edges[1] as WorkflowDefinition['edges'][number]],
  },
  settings: [],
};

describe('spec 009 — FR-010: diff visual no canvas', () => {
  it('FR-010: marca adicionados, alterados e removidos (fantasmas com as arestas antigas)', () => {
    const canvas = diffCanvas(diff, from, to);
    expect(canvas.nodes.map((n) => [n.node.id, n.status])).toEqual([
      ['a', undefined],
      ['b', 'changed'],
      ['new', 'added'],
      ['old', 'removed'],
    ]);
    expect(canvas.edges.map((e) => [e.edge.id, e.status])).toEqual([
      ['e1', undefined],
      ['e3', 'added'],
      ['removed:e2', 'removed'],
    ]);
  });

  it('FR-010: descreve o patch dos parâmetros com o valor anterior', () => {
    expect(describePatch({ op: 'replace', path: '/x', value: 2 }, { x: 1 })).toBe('x: 1 → 2');
    expect(describePatch({ op: 'add', path: '/fields/1', value: { n: 'a' } }, {})).toBe(
      'fields.1: + {"n":"a"}',
    );
    expect(describePatch({ op: 'remove', path: '/y' }, { y: 'v' })).toBe('y: − "v"');
    expect(valueAt({ 'a/b': { c: [5] } }, '/a~1b/c/0')).toBe(5);
  });
});
