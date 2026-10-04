import type { NodeDefinition } from '../../types.js';
import { executeIf } from './execute.js';
import { ALL_OPERATIONS, CONDITION_TYPES } from './operators.js';

/**
 * Desvio condicional por item (FR-010, spec 003). Equivale ao `n8n-nodes-base.if` v2:
 * condições tipadas combinadas por E/OU, saídas `true` e `false`.
 */
export const ifNode: NodeDefinition = {
  type: 'logic.if',
  version: 1,
  displayName: 'Se (If)',
  description: 'Encaminha cada item para a saída verdadeira ou falsa conforme as condições.',
  icon: 'git-branch',
  category: 'logic',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [
    { name: 'true', displayName: 'Verdadeiro', kind: 'main' },
    { name: 'false', displayName: 'Falso', kind: 'main' },
  ],
  paramsSchema: {
    type: 'object',
    properties: {
      conditions: {
        type: 'object',
        title: 'Condições',
        default: { combinator: 'and', conditions: [] },
        properties: {
          combinator: {
            type: 'string',
            title: 'Combinar condições com',
            enum: ['and', 'or'],
            default: 'and',
          },
          conditions: {
            type: 'array',
            title: 'Condições',
            default: [],
            items: {
              type: 'object',
              properties: {
                leftValue: { type: 'string', title: 'Valor', default: '' },
                operator: {
                  type: 'object',
                  title: 'Operação',
                  properties: {
                    type: {
                      type: 'string',
                      title: 'Tipo',
                      enum: [...CONDITION_TYPES],
                      default: 'string',
                    },
                    operation: {
                      type: 'string',
                      title: 'Operação',
                      enum: ALL_OPERATIONS,
                      default: 'equals',
                    },
                  },
                  required: ['type', 'operation'],
                  additionalProperties: false,
                },
                rightValue: { type: 'string', title: 'Comparar com', default: '' },
              },
              required: ['operator'],
              additionalProperties: false,
            },
          },
        },
        required: ['combinator', 'conditions'],
        additionalProperties: false,
      },
      looseTypeValidation: {
        type: 'boolean',
        title: 'Conversão flexível de tipos',
        description:
          'Converte resultados de expressões para o tipo da condição em vez de exigir o tipo exato.',
        default: false,
      },
    },
    additionalProperties: false,
  },
  execute: executeIf,
};
