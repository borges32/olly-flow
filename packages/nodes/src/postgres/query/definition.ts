import type { JSONSchema7, NodeDefinition } from '../../types.js';
import {
  DEFAULT_MAX_ROWS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  executePostgresQuery,
  type PostgresDeps,
} from './execute.js';

export const postgresQueryParamsSchema: JSONSchema7 = {
  type: 'object',
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      title: 'SQL',
      description:
        'Valores entram só como parâmetros posicionais ($1, $2...). O SQL não aceita expressões (FR-012).',
      minLength: 1,
      default: '',
      'x-no-expression': true,
      'x-multiline': true,
    } as JSONSchema7,
    queryParameters: {
      type: 'array',
      title: 'Parâmetros ($1, $2...)',
      description: 'Na ordem: o primeiro é $1. Aceitam expressões.',
      default: [],
      items: {
        type: 'object',
        properties: { value: { type: 'string', title: 'Valor', default: '' } },
        additionalProperties: false,
      },
    },
    mode: {
      type: 'string',
      title: 'Execução',
      description:
        '`once`: uma vez para todos os itens (parâmetros do 1º item); `perItem`: uma vez por item.',
      enum: ['once', 'perItem'],
      default: 'once',
    },
    options: {
      type: 'object',
      title: 'Opções',
      default: {},
      properties: {
        maxRows: {
          type: 'integer',
          title: 'Máximo de linhas',
          minimum: 1,
          default: DEFAULT_MAX_ROWS,
        },
        statementTimeoutMs: {
          type: 'integer',
          title: 'Timeout do comando (ms)',
          minimum: 1,
          default: DEFAULT_STATEMENT_TIMEOUT_MS,
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

/** Consulta SQL parametrizada (spec 004, FR-011 a FR-013, plan §6). */
export function createPostgresQueryNode(deps: PostgresDeps): NodeDefinition {
  return {
    type: 'postgres.query',
    version: 1,
    displayName: 'PostgreSQL: consulta',
    description: 'Executa SQL parametrizado num banco PostgreSQL; cada linha vira um item.',
    icon: 'database',
    category: 'integration',
    inputs: [{ name: 'main', kind: 'main' }],
    outputs: [{ name: 'main', kind: 'main' }],
    // Spec 006, FR-009: itens em paralelo (aba Configurações do nó).
    supportsParallelItems: true,
    credentialTypes: ['postgres'],
    paramsSchema: postgresQueryParamsSchema,
    execute: (input, ctx) => executePostgresQuery(input, ctx, deps),
  };
}
