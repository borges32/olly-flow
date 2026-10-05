import type { JSONSchema7, NodeDefinition } from '../../types.js';
import { DEFAULT_STATEMENT_TIMEOUT_MS } from '../query/execute.js';
import { executePostgresWrite, type PostgresWriteDeps } from './execute.js';

export const WRITE_OPERATIONS = ['insert', 'update', 'upsert'] as const;
export const DEFAULT_WRITE_BATCH_SIZE = 100;

const column = (title: string): JSONSchema7 =>
  ({
    type: 'string',
    title,
    minLength: 1,
    'x-no-expression': true,
    'x-load-options': 'postgresColumns',
  }) as JSONSchema7;

export const postgresWriteParamsSchema: JSONSchema7 = {
  type: 'object',
  required: ['operation', 'table'],
  properties: {
    operation: {
      type: 'string',
      title: 'Operação',
      enum: [...WRITE_OPERATIONS],
      default: 'insert',
    },
    schema: {
      type: 'string',
      title: 'Schema',
      default: 'public',
      'x-no-expression': true,
      'x-load-options': 'postgresSchemas',
    } as JSONSchema7,
    table: {
      type: 'string',
      title: 'Tabela',
      default: '',
      'x-no-expression': true,
      'x-load-options': 'postgresTables',
    } as JSONSchema7,
    columns: {
      type: 'object',
      title: 'Colunas',
      default: {},
      properties: {
        mappingMode: {
          type: 'string',
          title: 'Mapeamento',
          description: '`autoMap`: cada campo do item vai para a coluna de mesmo nome.',
          enum: ['autoMap', 'defineBelow'],
          default: 'autoMap',
        },
        values: {
          type: 'array',
          title: 'Valores',
          default: [],
          'x-display-options': { show: { mappingMode: ['defineBelow'] } },
          items: {
            type: 'object',
            properties: {
              column: column('Coluna'),
              value: { type: 'string', title: 'Valor', default: '' },
            },
            required: ['column'],
            additionalProperties: false,
          },
        } as JSONSchema7,
      },
      additionalProperties: false,
    },
    matchingColumns: {
      type: 'array',
      title: 'Colunas de correspondência',
      description: 'Identificam a linha no update e o conflito no upsert.',
      default: [],
      'x-display-options': { show: { operation: ['update', 'upsert'] } },
      items: {
        type: 'object',
        properties: { column: column('Coluna') },
        required: ['column'],
        additionalProperties: false,
      },
    } as JSONSchema7,
    options: {
      type: 'object',
      title: 'Opções',
      default: {},
      properties: {
        transaction: {
          type: 'string',
          title: 'Transação',
          description: '`allItems`: tudo ou nada; `none`: cada lote (ou item) por si.',
          enum: ['none', 'allItems'],
          default: 'none',
        },
        batchSize: {
          type: 'integer',
          title: 'Linhas por lote (insert/upsert)',
          minimum: 1,
          default: DEFAULT_WRITE_BATCH_SIZE,
        },
        returning: {
          type: 'string',
          title: 'Retornar colunas',
          description:
            '`*`, lista separada por vírgulas, ou vazio para repassar os itens de entrada.',
          default: '*',
        },
        skipOnConflict: {
          type: 'boolean',
          title: 'Ignorar conflitos (insert)',
          description: 'Usa `ON CONFLICT DO NOTHING`.',
          default: false,
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

/** Inserir, atualizar e upsert com mapeamento de colunas (spec 004, FR-014, FR-015, plan §7). */
export function createPostgresWriteNode(deps: PostgresWriteDeps): NodeDefinition {
  return {
    type: 'postgres.write',
    version: 1,
    displayName: 'PostgreSQL: gravar',
    description: 'Insere, atualiza ou faz upsert de registros a partir dos itens.',
    icon: 'database',
    category: 'integration',
    inputs: [{ name: 'main', kind: 'main' }],
    outputs: [{ name: 'main', kind: 'main' }],
    // Spec 006, FR-009: itens em paralelo (aba Configurações do nó).
    supportsParallelItems: true,
    credentialTypes: ['postgres'],
    paramsSchema: postgresWriteParamsSchema,
    execute: (input, ctx) => executePostgresWrite(input, ctx, deps),
  };
}
