import type { JSONSchema7 } from 'json-schema';
import type { NodeDefinition } from '../../types.js';
import { CLASH_HANDLING, JOIN_MODES, MERGE_MODES, WAIT_FOR, executeMerge } from './execute.js';

const showFor = (...modes: string[]) => ({ show: { mode: modes } });

/**
 * Junta ramos (spec 007, FR-001–FR-004). Equivale ao `n8n-nodes-base.merge` v3, com 2 a 10
 * entradas (divergência prevista na ADR-0001: o N8N tem 2).
 */
export const mergeNode: NodeDefinition = {
  type: 'logic.merge',
  version: 1,
  displayName: 'Juntar (Merge)',
  description:
    'Combina os itens de vários ramos: concatenar, por posição, por campos (join) ou escolher um ramo.',
  icon: 'merge',
  category: 'logic',
  inputs: [
    { name: 'input1', displayName: 'Entrada 1', kind: 'main' },
    { name: 'input2', displayName: 'Entrada 2', kind: 'main' },
  ],
  outputs: [{ name: 'main', kind: 'main' }],
  dynamicPorts: { kind: 'mergeInputs' },
  paramsSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        title: 'Modo',
        enum: [...MERGE_MODES],
        default: 'append',
        description:
          'append: concatena; combineByPosition: une por posição; combineByFields: join por campo (2 entradas); chooseBranch: uma entrada; waitAll: espera todas e emite a entrada 1.',
      },
      numberInputs: {
        type: 'integer',
        title: 'Número de entradas',
        minimum: 2,
        maximum: 10,
        default: 2,
        'x-no-expression': true,
      } as JSONSchema7,
      includeUnpaired: {
        type: 'boolean',
        title: 'Incluir itens sem par',
        default: false,
        'x-display-options': showFor('combineByPosition'),
      } as JSONSchema7,
      fields: {
        type: 'array',
        title: 'Campos para combinar',
        default: [{ input1Field: '', input2Field: '' }],
        'x-display-options': showFor('combineByFields'),
        items: {
          type: 'object',
          properties: {
            input1Field: { type: 'string', title: 'Campo da entrada 1', default: '' },
            input2Field: { type: 'string', title: 'Campo da entrada 2', default: '' },
          },
          additionalProperties: false,
        },
      } as JSONSchema7,
      joinMode: {
        type: 'string',
        title: 'Tipo de junção',
        enum: [...JOIN_MODES],
        default: 'inner',
        description:
          'inner: só os que casam; left: todos da entrada 1; outer: todos das duas; keepNonMatches: só os que não casam.',
        'x-display-options': showFor('combineByFields'),
      } as JSONSchema7,
      output: {
        type: 'string',
        title: 'Saída',
        enum: ['input', 'empty'],
        default: 'input',
        'x-display-options': showFor('chooseBranch'),
      } as JSONSchema7,
      chosenInput: {
        type: 'integer',
        title: 'Entrada escolhida',
        minimum: 1,
        maximum: 10,
        default: 1,
        'x-display-options': { show: { mode: ['chooseBranch'], output: ['input'] } },
      } as JSONSchema7,
      clashHandling: {
        type: 'string',
        title: 'Campos repetidos',
        enum: [...CLASH_HANDLING],
        default: 'preferLast',
        description:
          'preferInput1: vale a entrada 1; preferLast: vale a última; addSuffix: renomeia com _1, _2...',
        'x-display-options': showFor('combineByPosition', 'combineByFields'),
      } as JSONSchema7,
      waitFor: {
        type: 'string',
        title: 'Esperar por',
        enum: [...WAIT_FOR],
        default: 'allConnected',
        description:
          'allConnected: todas as entradas (vazias contam como lista vazia); anyWithData: usa só as entradas com dados.',
      },
    },
    additionalProperties: false,
  },
  execute: executeMerge,
};
