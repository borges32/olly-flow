import { createNodeRegistry } from '@olly/nodes';
import type { Edge, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { runWorkflow } from './run.js';
import { ExecutionState } from './state.js';

const registry = createNodeRegistry();
const node = (id: string, type: string, params: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type,
  name: id,
  params,
  position: [0, 0],
});
const set = (id: string, value: string) =>
  node(id, 'data.set', { fields: [{ name: 'v', type: 'string', value }] });
const edge = (from: string, to: string, fromPort = 'main', toPort = 'main'): Edge => ({
  id: `${from}-${fromPort}-${to}-${toPort}`,
  from,
  fromPort,
  to,
  toPort,
});
// If com condição sempre verdadeira: a saída `false` sai vazia.
const alwaysTrue = node('if', 'logic.if', {
  conditions: {
    combinator: 'and',
    conditions: [{ leftValue: 'true', operator: { type: 'boolean', operation: 'true' } }],
  },
});
const def = (nodes: WorkflowNode[], edges: Edge[]): WorkflowDefinition => ({
  nodes,
  edges,
  settings: {},
});

describe('spec 006 — FR-007: propagação de "sem dados"', () => {
  it('FR-007: ramo sem itens não executa os seguintes e não bloqueia os demais', async () => {
    const result = await runWorkflow(
      def(
        [
          node('m', 'trigger.manual'),
          alwaysTrue,
          set('sim', 's'),
          set('nao', 'n'),
          set('depois', 'd'),
        ],
        [
          edge('m', 'if'),
          edge('if', 'sim', 'true'),
          edge('if', 'nao', 'false'),
          edge('nao', 'depois'),
        ],
      ),
      registry,
    );
    expect(result.status).toBe('success');
    expect(result.nodes.sim?.status).toBe('success');
    expect(result.nodes.nao?.status).toBe('skipped');
    // "Sem dados" se propaga: o filho do ramo vazio também é pulado.
    expect(result.nodes.depois?.status).toBe('skipped');
  });

  it('FR-007: porta sem dados conta como resolvida para quem espera várias entradas', () => {
    const d = def(
      [node('m', 'trigger.manual'), alwaysTrue, set('junta', 'j')],
      [edge('if', 'junta', 'true'), edge('if', 'junta', 'false', 'outra')],
    );
    const state = new ExecutionState(d);
    expect(state.readiness('junta')).toBe('waiting');
    Object.assign(state.get('if'), {
      status: 'success',
      output: { true: [{ json: {} }], false: [] },
    });
    expect(state.portStates('junta')).toEqual({ main: 'data', outra: 'noData' });
    expect(state.readiness('junta')).toBe('ready');
  });

  it('FR-007: todas as portas sem dados: o nó é pulado', () => {
    const d = def([alwaysTrue, set('a', 'x')], [edge('if', 'a', 'false')]);
    const state = new ExecutionState(d);
    Object.assign(state.get('if'), {
      status: 'success',
      output: { true: [{ json: {} }], false: [] },
    });
    expect(state.readiness('a')).toBe('noData');
    Object.assign(state.get('if'), { status: 'skipped', output: {} });
    expect(state.readiness('a')).toBe('noData');
  });

  it('FR-007: nó com uma porta ainda não resolvida continua aguardando', () => {
    const d = def(
      [set('a', '1'), set('b', '2'), set('c', '3')],
      [edge('a', 'c'), edge('b', 'c', 'main', 'outra')],
    );
    const state = new ExecutionState(d);
    Object.assign(state.get('a'), { status: 'success', output: { main: [{ json: {} }] } });
    expect(state.portStates('c')).toEqual({ main: 'data', outra: 'unresolved' });
    expect(state.readiness('c')).toBe('waiting');
  });
});
