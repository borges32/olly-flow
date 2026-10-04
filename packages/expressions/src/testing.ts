import type { Item } from '@olly/shared-types';
import type { ExpressionData, ReferencedNodeData } from './types.js';

/** Dados de expressão para testes, com padrões razoáveis. */
export function expressionData(overrides: Partial<ExpressionData> = {}): ExpressionData {
  return {
    nodeName: 'Atual',
    params: {},
    input: [{ json: {} }],
    nodes: {},
    paired: [],
    vars: {},
    env: {},
    execution: { id: 'exec-1', mode: 'test' },
    workflow: { id: 'wf-1', name: 'Fluxo', active: false },
    timezone: 'America/Sao_Paulo',
    ...overrides,
  };
}

export function referencedNode(
  items: Item[],
  extra: Partial<ReferencedNodeData> = {},
): ReferencedNodeData {
  return { executed: true, outputs: { main: items }, outputOrder: ['main'], params: {}, ...extra };
}
