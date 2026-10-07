import type { JSONSchema7, NodeDefinition } from '../../types.js';

export const PLACEHOLDER_NODE_TYPE = 'placeholder.unsupported';

const unsupported = (type: unknown) =>
  new Error(
    `Nó não suportado (${typeof type === 'string' && type ? type : 'tipo desconhecido'}): substitua-o por um nó do Olly Flow antes de executar`,
  );

/**
 * Nó marcador (spec 015, FR-016): guarda um nó importado que o Olly Flow não suporta (tipo
 * desconhecido ou tipo do N8N sem conversão), com o conteúdo original e as portas das conexões
 * originais. É importado desabilitado (repassa os itens) e bloqueia a publicação.
 */
export const placeholderNode: NodeDefinition = {
  type: PLACEHOLDER_NODE_TYPE,
  version: 1,
  displayName: 'Nó não suportado',
  description:
    'Marcador de um nó importado que o Olly Flow não suporta. Substitua-o antes de publicar.',
  icon: 'circle-help',
  category: 'flow',
  inputs: [{ name: 'in0', kind: 'main' }],
  outputs: [{ name: 'out0', kind: 'main' }],
  dynamicPorts: { kind: 'placeholder' },
  paramsSchema: {
    type: 'object',
    properties: {
      originalType: {
        type: 'string',
        title: 'Tipo original',
        default: '',
        'x-no-expression': true,
      } as JSONSchema7,
      originalTypeVersion: { type: 'number', title: 'Versão do tipo original' },
      reason: {
        type: 'string',
        title: 'Motivo',
        default: '',
        'x-multiline': true,
        'x-no-expression': true,
      } as JSONSchema7,
      originalJson: {
        type: 'string',
        title: 'Conteúdo original (JSON)',
        description: 'O nó como estava no arquivo importado.',
        default: '',
        'x-multiline': true,
        'x-no-expression': true,
      } as JSONSchema7,
      ports: {
        type: 'object',
        default: {},
        'x-hidden': true,
        properties: {
          inputs: { type: 'array', items: { type: 'string' } },
          outputs: { type: 'array', items: { type: 'string' } },
        },
      } as JSONSchema7,
    },
  },
  execute: (_input, ctx) => Promise.reject(unsupported(ctx.node.params.originalType)),
  supplyData: (ctx) => Promise.reject(unsupported(ctx.node.params.originalType)),
};
