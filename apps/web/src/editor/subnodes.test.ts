import type { NodeDescription } from '@olly/nodes';
import type { Edge, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { connectionRejection, isSubNodeEdge } from './subnodes';

const types = new Map<string, NodeDescription>(
  (
    [
      {
        type: 'ai.agent',
        inputs: [
          { name: 'main', kind: 'main' },
          {
            name: 'ai_languageModel',
            displayName: 'Modelo',
            kind: 'ai_languageModel',
            maxConnections: 1,
          },
          { name: 'ai_memory', displayName: 'Memória', kind: 'ai_memory', maxConnections: 1 },
          { name: 'ai_tool', displayName: 'Ferramentas', kind: 'ai_tool' },
        ],
        outputs: [{ name: 'main', kind: 'main' }],
      },
      {
        type: 'ai.chatModel',
        inputs: [],
        outputs: [{ name: 'ai_languageModel', kind: 'ai_languageModel' }],
      },
      { type: 'tool.code', inputs: [], outputs: [{ name: 'ai_tool', kind: 'ai_tool' }] },
      {
        type: 'data.set',
        inputs: [{ name: 'main', kind: 'main' }],
        outputs: [{ name: 'main', kind: 'main' }],
      },
    ] as unknown as NodeDescription[]
  ).map((t) => [t.type, t]),
);
const node = (id: string, type: string): WorkflowNode => ({
  id,
  type,
  name: id,
  params: {},
  position: [0, 0],
});
const nodes = [
  node('agent', 'ai.agent'),
  node('m1', 'ai.chatModel'),
  node('m2', 'ai.chatModel'),
  node('t1', 'tool.code'),
  node('t2', 'tool.code'),
  node('set', 'data.set'),
];
const link = (from: string, fromPort: string, to: string, toPort: string) => ({
  from,
  fromPort,
  to,
  toPort,
});

describe('spec 011 — FR-001: conexões de sub-nós no canvas', () => {
  it('FR-001: sub-nó liga na porta do mesmo tipo da base do Agent', () => {
    expect(
      connectionRejection(
        types,
        nodes,
        [],
        link('m1', 'ai_languageModel', 'agent', 'ai_languageModel'),
      ),
    ).toBeNull();
    expect(
      connectionRejection(types, nodes, [], link('t1', 'ai_tool', 'agent', 'ai_tool')),
    ).toBeNull();
  });

  it('FR-001: sub-nó não entra no fluxo principal, e cada porta aceita só o seu tipo', () => {
    expect(
      connectionRejection(types, nodes, [], link('m1', 'ai_languageModel', 'set', 'main')),
    ).toContain('só se conectam à base do Agent');
    expect(
      connectionRejection(types, nodes, [], link('t1', 'ai_tool', 'agent', 'ai_languageModel')),
    ).toBe('Esta entrada aceita só modelo');
    expect(connectionRejection(types, nodes, [], link('set', 'main', 'agent', 'ai_tool'))).toBe(
      'Esta entrada aceita só ferramenta',
    );
  });

  it('FR-001: no máximo 1 modelo; ferramentas sem limite', () => {
    const edges: Edge[] = [
      { id: 'e', ...link('m1', 'ai_languageModel', 'agent', 'ai_languageModel') },
    ];
    expect(
      connectionRejection(
        types,
        nodes,
        edges,
        link('m2', 'ai_languageModel', 'agent', 'ai_languageModel'),
      ),
    ).toContain('no máximo 1 conexão');
    const tools: Edge[] = [{ id: 'e', ...link('t1', 'ai_tool', 'agent', 'ai_tool') }];
    expect(
      connectionRejection(types, nodes, tools, link('t2', 'ai_tool', 'agent', 'ai_tool')),
    ).toBeNull();
  });

  it('FR-001: a conexão de sub-nó é identificada (desenho tracejado)', () => {
    expect(
      isSubNodeEdge(types, nodes, { id: 'a', ...link('t1', 'ai_tool', 'agent', 'ai_tool') }),
    ).toBe(true);
    expect(isSubNodeEdge(types, nodes, { id: 'b', ...link('set', 'main', 'agent', 'main') })).toBe(
      false,
    );
  });
});
