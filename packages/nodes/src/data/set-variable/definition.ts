import type { NodeDefinition } from '../../types.js';
import { executeSetVariable } from './execute.js';

/**
 * Grava variáveis da execução, lidas pelos nós seguintes em `$vars` (FR-009, spec 003).
 * Divergência do N8N (ADR-0001): lá `$vars` são variáveis globais somente leitura.
 */
export const setVariableNode: NodeDefinition = {
  type: 'data.setVariable',
  version: 1,
  displayName: 'Definir variável',
  description: 'Grava variáveis da execução, acessíveis em $vars; repassa os itens sem alteração.',
  icon: 'variable',
  category: 'data',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: {
    type: 'object',
    properties: {
      variables: {
        type: 'array',
        title: 'Variáveis',
        description: 'Com vários itens, cada item é avaliado em ordem e o último valor prevalece.',
        default: [],
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', title: 'Nome', minLength: 1 },
            value: { type: 'string', title: 'Valor', default: '' },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  execute: executeSetVariable,
};
