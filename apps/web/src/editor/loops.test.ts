import type { Edge, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { edgeLoopInfo, invalidConnectionReason } from './loops';

const n = (id: string, type = 'data.set'): WorkflowNode => ({
  id,
  type,
  name: id,
  params: {},
  position: [0, 0],
});
const e = (from: string, to: string, fromPort = 'main', toPort = 'main'): Edge => ({
  id: `${from}-${to}-${toPort}`,
  from,
  fromPort,
  to,
  toPort,
});
const nodes = [n('m', 'trigger.manual'), n('w', 'logic.while'), n('a'), n('b')];

describe('spec 007 — FR-016: arestas de retorno e ciclos inválidos no editor', () => {
  it('FR-016: a volta para a continue do While é aresta de retorno', () => {
    const edges = [e('m', 'w'), e('w', 'a', 'loop'), e('a', 'w', 'main', 'continue')];
    expect([...edgeLoopInfo(nodes, edges).back]).toEqual(['a-w-continue']);
    const invalid = edgeLoopInfo(nodes, [e('m', 'a'), e('a', 'b'), e('b', 'a')]).invalid;
    expect([...invalid.keys()].sort()).toEqual(['a-b-main', 'b-a-main']);
  });

  it('FR-016: conexão que criaria ciclo inválido é recusada com o motivo', () => {
    const edges = [e('m', 'a'), e('a', 'b')];
    expect(invalidConnectionReason(nodes, edges, e('b', 'a'))).toMatch(/entrada "continue"/);
    expect(invalidConnectionReason(nodes, edges, e('m', 'b'))).toBeNull();
  });

  it('FR-008: voltar pela continue do While é permitido', () => {
    const edges = [e('m', 'w'), e('w', 'a', 'loop')];
    expect(invalidConnectionReason(nodes, edges, e('a', 'w', 'main', 'continue'))).toBeNull();
  });
});
