import type { NodeDefinition } from '../../types.js';
import { executeSet } from './execute.js';

export const SET_FIELD_TYPES = ['string', 'number', 'boolean', 'json'] as const;
export type SetFieldType = (typeof SET_FIELD_TYPES)[number];

/**
 * Define campos nos itens (FR-018 da spec 002; FR-008 da spec 003). Equivale ao
 * `n8n-nodes-base.set` (Edit Fields): nomes com notação de ponto criam campos aninhados e os
 * valores aceitam expressões.
 */
export const setNode: NodeDefinition = {
  type: 'data.set',
  version: 1,
  displayName: 'Definir campos',
  description: 'Define ou altera campos dos itens com valores tipados.',
  icon: 'pen-line',
  category: 'data',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        title: 'Campos',
        description: 'Use notação de ponto para campos aninhados (ex.: cliente.nome).',
        default: [],
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', title: 'Nome', minLength: 1 },
            type: { type: 'string', title: 'Tipo', enum: [...SET_FIELD_TYPES], default: 'string' },
            value: { type: 'string', title: 'Valor', default: '' },
          },
          required: ['name', 'type'],
          additionalProperties: false,
        },
      },
      includeOtherFields: {
        type: 'boolean',
        title: 'Incluir os demais campos do item',
        default: false,
      },
      // Alias da spec 002 (includeOtherFields = !keepOnlySet), mantido para workflows salvos.
      keepOnlySet: { type: 'boolean', 'x-hidden': true } as Record<string, unknown>,
    },
    additionalProperties: false,
  },
  execute: executeSet,
};
