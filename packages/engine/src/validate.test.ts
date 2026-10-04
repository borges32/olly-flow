import { createNodeRegistry } from '@olly/nodes';
import type { Edge, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { validateWorkflow } from './validate.js';

const registry = createNodeRegistry();

const node = (id: string, type = 'data.set', name = id): WorkflowNode => ({
  id,
  type,
  name,
  params: {},
  position: [0, 0],
});
const edge = (from: string, to: string, fromPort = 'main', toPort = 'main'): Edge => ({
  id: `${from}-${to}-${fromPort}-${toPort}`,
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

describe('spec 002 — FR-004/FR-005: validação estrutural ao salvar', () => {
  it('FR-004: workflow válido não tem erros nem avisos', () => {
    const result = validateWorkflow(
      def([node('t', 'trigger.manual'), node('s')], [edge('t', 's')]),
      registry,
    );
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('FR-004/FR-005: conexão para nó inexistente identifica o nó existente', () => {
    const { errors } = validateWorkflow(
      def([node('t', 'trigger.manual')], [edge('t', 'fantasma')]),
      registry,
    );
    expect(errors).toEqual([
      expect.objectContaining({ code: 'EDGE_UNKNOWN_NODE', nodeIds: ['t'] }) as unknown,
    ]);
  });

  it('FR-004/FR-005: conexão para porta inexistente identifica os dois nós', () => {
    const { errors } = validateWorkflow(
      def([node('t', 'trigger.manual'), node('s')], [edge('t', 's', 'true', 'main')]),
      registry,
    );
    expect(errors.map((e) => [e.code, e.nodeIds])).toEqual([['EDGE_UNKNOWN_PORT', ['t', 's']]]);
    expect(errors[0]?.message).toContain('não tem a saída "true"');
  });

  it('FR-004/FR-005: nomes duplicados apontam todos os nós com o nome', () => {
    const { errors } = validateWorkflow(
      def(
        [node('t', 'trigger.manual'), node('a', 'data.set', 'X'), node('b', 'data.set', 'X')],
        [edge('t', 'a'), edge('t', 'b')],
      ),
      registry,
    );
    expect(errors.map((e) => [e.code, e.nodeIds])).toEqual([['DUPLICATE_NODE_NAME', ['a', 'b']]]);
  });

  it('FR-004/FR-005: ciclo lista os nós do ciclo', () => {
    const { errors } = validateWorkflow(
      def(
        [node('t', 'trigger.manual'), node('a'), node('b'), node('c')],
        [edge('t', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
      ),
      registry,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'CYCLE', nodeIds: ['a', 'b', 'c'] });
  });

  it('FR-004: laço de um nó para ele mesmo é ciclo', () => {
    const { errors } = validateWorkflow(
      def([node('t', 'trigger.manual'), node('a')], [edge('t', 'a'), edge('a', 'a')]),
      registry,
    );
    expect(errors.map((e) => [e.code, e.nodeIds])).toEqual([['CYCLE', ['a']]]);
  });

  it('FR-004: tipo de nó desconhecido é erro', () => {
    const { errors } = validateWorkflow(def([node('x', 'nao.existe')], []), registry);
    expect(errors.map((e) => [e.code, e.nodeIds])).toEqual([['NODE_UNKNOWN_TYPE', ['x']]]);
  });

  it('FR-004: nó órfão gera apenas aviso', () => {
    const result = validateWorkflow(
      def([node('t', 'trigger.manual'), node('s'), node('solto')], [edge('t', 's')]),
      registry,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => [w.code, w.nodeIds])).toEqual([['ORPHAN_NODE', ['solto']]]);
  });

  it('FR-004: workflow com um único nó não gera aviso de órfão', () => {
    expect(validateWorkflow(def([node('t', 'trigger.manual')], []), registry).warnings).toEqual([]);
  });
});
