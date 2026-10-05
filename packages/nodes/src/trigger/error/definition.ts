import type { NodeOutput } from '@olly/shared-types';
import type { NodeDefinition, NodeExecuteInput } from '../../types.js';

/** Exemplo emitido ao testar o workflow de erro pelo editor (sem uma falha real). */
export const SAMPLE_ERROR_PAYLOAD = {
  execution: {
    id: 'exemplo',
    url: 'http://localhost:5173/executions/exemplo',
    error: { message: 'Exemplo de erro (execução de teste do workflow de erro)', stack: '' },
    lastNodeExecuted: 'Nó com erro',
    mode: 'webhook',
  },
  workflow: { id: 'exemplo', name: 'Workflow que falhou' },
};

function executeErrorTrigger(input: NodeExecuteInput): Promise<NodeOutput> {
  const items =
    input.items.length > 0 ? input.items : [{ json: structuredClone(SAMPLE_ERROR_PAYLOAD) }];
  return Promise.resolve({ main: items });
}

/**
 * Gatilho do workflow de erro (spec 007, FR-014): acionado quando uma execução de produção de
 * outro workflow falha, com o payload do Error Trigger do N8N
 * (`{ execution: { id, url, error, lastNodeExecuted, mode }, workflow: { id, name } }`).
 */
export const errorTrigger: NodeDefinition = {
  type: 'trigger.error',
  version: 1,
  displayName: 'Gatilho de erro',
  description:
    'Inicia este workflow quando uma execução de produção de outro workflow (que o indique como workflow de erro) falha.',
  icon: 'siren',
  category: 'trigger',
  inputs: [],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute: executeErrorTrigger,
};
