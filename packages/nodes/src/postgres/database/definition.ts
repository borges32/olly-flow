import { POSTGRES_NODE_TYPE } from '@olly/shared-types';
import type { JSONSchema7 } from 'json-schema';
import { NodeParameterError } from '../../errors.js';
import type { Item, NodeOutput } from '@olly/shared-types';
import type { NodeContext, NodeDefinition, NodeExecuteInput } from '../../types.js';
import { postgresQueryParamsSchema } from '../query/definition.js';
import { executePostgresQuery } from '../query/execute.js';
import { postgresWriteParamsSchema } from '../write/definition.js';
import { executePostgresWrite } from '../write/execute.js';
import { CONDITION_OPERATORS } from './conditions.js';
import {
  DEFAULT_SELECT_LIMIT,
  DELETE_COMMANDS,
  executeDelete,
  executeSelect,
  type PostgresDatabaseDeps,
} from './operations.js';

/** Operações do nó, com os nomes do N8N (spec 022, FR-001). */
export const POSTGRES_OPERATIONS = [
  'executeQuery',
  'select',
  'insert',
  'update',
  'upsert',
  'deleteTable',
] as const;
type Operation = (typeof POSTGRES_OPERATIONS)[number];
const WRITE_OPS: Operation[] = ['insert', 'update', 'upsert'];

const query = postgresQueryParamsSchema.properties as Record<string, JSONSchema7>;
const write = postgresWriteParamsSchema.properties as Record<string, JSONSchema7>;
const show = (operations: Operation[], extra: Record<string, unknown[]> = {}) => ({
  'x-display-options': { show: { operation: operations, ...extra } },
});
const when = (schema: JSONSchema7, operations: Operation[]): JSONSchema7 => ({
  ...schema,
  ...show(operations),
});

const column = (title: string): JSONSchema7 =>
  ({
    type: 'string',
    title,
    minLength: 1,
    'x-no-expression': true,
    'x-load-options': 'postgresColumns',
  }) as JSONSchema7;

/** Condições da seleção e da exclusão (FR-005); só no `delete` entre os comandos de exclusão. */
const conditionsVisibility = {
  'x-display-options': {
    show: { operation: ['select', 'deleteTable'] },
    hide: { deleteCommand: ['truncate', 'drop'] },
  },
};

export const postgresDatabaseParamsSchema: JSONSchema7 = {
  type: 'object',
  required: ['operation'],
  properties: {
    operation: {
      type: 'string',
      title: 'Operação',
      description:
        '`executeQuery`: SQL; `select`: buscar linhas; `insert`, `update`, `upsert`: gravar; `deleteTable`: excluir linhas, esvaziar ou remover a tabela.',
      enum: [...POSTGRES_OPERATIONS],
      default: 'insert',
    },
    // Executar consulta (spec 004, FR-011 a FR-013).
    query: when(query.query as JSONSchema7, ['executeQuery']),
    queryParameters: when(query.queryParameters as JSONSchema7, ['executeQuery']),
    mode: when(query.mode as JSONSchema7, ['executeQuery']),
    queryOptions: when(query.options as JSONSchema7, ['executeQuery']),
    // Tabela: todas as operações, menos a consulta.
    schema: when(write.schema as JSONSchema7, ['select', ...WRITE_OPS, 'deleteTable']),
    table: when(write.table as JSONSchema7, ['select', ...WRITE_OPS, 'deleteTable']),
    // Gravar (spec 004, FR-014, FR-015).
    columns: when(write.columns as JSONSchema7, WRITE_OPS),
    matchingColumns: when(write.matchingColumns as JSONSchema7, ['update', 'upsert']),
    writeOptions: when(write.options as JSONSchema7, WRITE_OPS),
    // Excluir (FR-004).
    deleteCommand: {
      type: 'string',
      title: 'Comando',
      description:
        '`delete`: excluir as linhas que atendem às condições (sem condições, todas); `truncate`: esvaziar a tabela; `drop`: remover a tabela.',
      enum: [...DELETE_COMMANDS],
      default: 'delete',
      ...show(['deleteTable']),
    } as JSONSchema7,
    // Selecionar (FR-003).
    returnAll: {
      type: 'boolean',
      title: 'Todas as linhas',
      default: false,
      ...show(['select']),
    } as JSONSchema7,
    limit: {
      type: 'integer',
      title: 'Limite de linhas',
      minimum: 1,
      default: DEFAULT_SELECT_LIMIT,
      ...show(['select'], { returnAll: [false] }),
    } as JSONSchema7,
    where: {
      type: 'array',
      title: 'Condições',
      description: 'Sem condições, vale para todas as linhas.',
      default: [],
      ...conditionsVisibility,
      items: {
        type: 'object',
        properties: {
          column: column('Coluna'),
          condition: {
            type: 'string',
            title: 'Operador',
            enum: [...CONDITION_OPERATORS],
            default: 'equal',
          },
          value: {
            type: 'string',
            title: 'Valor',
            description: 'Ignorado em `IS NULL` e `IS NOT NULL`. Aceita expressão.',
            default: '',
          },
        },
        required: ['column'],
        additionalProperties: false,
      },
    } as JSONSchema7,
    combineConditions: {
      type: 'string',
      title: 'Combinar condições',
      enum: ['AND', 'OR'],
      default: 'AND',
      ...conditionsVisibility,
    } as JSONSchema7,
    sort: {
      type: 'array',
      title: 'Ordenar',
      default: [],
      ...show(['select']),
      items: {
        type: 'object',
        properties: {
          column: column('Coluna'),
          direction: { type: 'string', title: 'Direção', enum: ['ASC', 'DESC'], default: 'ASC' },
        },
        required: ['column'],
        additionalProperties: false,
      },
    } as JSONSchema7,
    deleteOptions: {
      type: 'object',
      title: 'Opções',
      default: {},
      ...show(['deleteTable']),
      properties: {
        cascade: {
          type: 'boolean',
          title: 'Em cascata (CASCADE)',
          description: '`truncate` e `drop`: também nas tabelas que dependem desta.',
          default: false,
        },
        restartSequences: {
          type: 'boolean',
          title: 'Reiniciar sequências (RESTART IDENTITY)',
          description: 'Só no `truncate`.',
          default: false,
        },
        statementTimeoutMs: {
          type: 'integer',
          title: 'Timeout do comando (ms)',
          minimum: 1,
          default: 30_000,
        },
      },
      additionalProperties: false,
    } as JSONSchema7,
  },
  additionalProperties: false,
};

/**
 * Os executores da spec 004 leem `options`; no nó único, as opções ficam por operação
 * (`queryOptions`, `writeOptions`), porque o `x-display-options` só enxerga campos irmãos.
 */
function withOptionsFrom(ctx: NodeContext, param: string): NodeContext {
  return Object.assign(Object.create(ctx) as NodeContext, {
    getParam: (name: string, itemIndex: number) =>
      ctx.getParam(name === 'options' ? param : name, itemIndex),
  });
}

/**
 * Nó PostgreSQL único, como o "Postgres" do N8N (spec 022): executar consulta, selecionar,
 * inserir, atualizar, upsert e excluir.
 */
/**
 * Correção 19/10/2026: como o N8N (e como o "Executar consulta" já fazia), o item de entrada
 * cuja operação não devolveu nenhuma linha (DELETE que não atingiu linhas, UPDATE sem
 * correspondência, seleção vazia) gera `{ success: true }`, vinculado a ele, na posição dele, e
 * o fluxo segue. Itens que foram para a saída de erro não ganham o item de sucesso.
 */
export function withSuccessItems(input: NodeExecuteInput, output: NodeOutput): NodeOutput {
  const covered = new Set<number>();
  for (const items of Object.values(output))
    for (const item of items) {
      const paired = item.pairedItem;
      if (paired && !Array.isArray(paired)) covered.add(paired.item);
    }
  if (input.items.every((_, i) => covered.has(i))) return output;
  const byItem = new Map<number, Item[]>();
  const unpaired: Item[] = [];
  for (const item of output.main ?? []) {
    const paired = item.pairedItem;
    if (paired && !Array.isArray(paired)) {
      byItem.set(paired.item, [...(byItem.get(paired.item) ?? []), item]);
    } else unpaired.push(item);
  }
  const main = input.items.flatMap((_, i) =>
    covered.has(i)
      ? (byItem.get(i) ?? [])
      : [{ json: { success: true }, pairedItem: { item: i } } satisfies Item],
  );
  return { ...output, main: [...main, ...unpaired] };
}

function runOperation(
  operation: Operation,
  input: NodeExecuteInput,
  ctx: NodeContext,
  deps: PostgresDatabaseDeps,
): Promise<NodeOutput> {
  switch (operation) {
    case 'executeQuery':
      return executePostgresQuery(input, withOptionsFrom(ctx, 'queryOptions'), deps);
    case 'insert':
    case 'update':
    case 'upsert':
      return executePostgresWrite(input, withOptionsFrom(ctx, 'writeOptions'), deps);
    case 'select':
      return executeSelect(input, ctx, deps);
    case 'deleteTable':
      return executeDelete(input, ctx, deps);
    default:
      throw new NodeParameterError(
        'operation',
        `operação desconhecida ${JSON.stringify(operation)}`,
      );
  }
}

export function createPostgresDatabaseNode(deps: PostgresDatabaseDeps): NodeDefinition {
  return {
    type: POSTGRES_NODE_TYPE,
    version: 1,
    displayName: 'PostgreSQL',
    description:
      'Consulta, seleciona, insere, atualiza, faz upsert ou exclui registros num banco PostgreSQL.',
    icon: 'database',
    category: 'integration',
    inputs: [{ name: 'main', kind: 'main' }],
    outputs: [{ name: 'main', kind: 'main' }],
    // Spec 006, FR-009: itens em paralelo (aba Configurações do nó).
    supportsParallelItems: true,
    credentialTypes: ['postgres'],
    paramsSchema: postgresDatabaseParamsSchema,
    execute: async (input, ctx) => {
      const operation = (ctx.getParam('operation', 0) ?? 'insert') as Operation;
      const output = await runOperation(operation, input, ctx, deps);
      switch (operation) {
        // Já emite `{ success: true }` por item, inclusive no modo "uma vez" (spec 004).
        case 'executeQuery':
          return output;
        // Uma consulta por item: cada item sem linhas ganha o seu.
        case 'select':
        case 'deleteTable':
          return withSuccessItems(input, output);
        // Gravação em lote vincula as linhas ao primeiro item quando não há correspondência
        // um a um: só a saída toda vazia (ex.: UPDATE sem correspondência) ganha o sucesso.
        default:
          return Object.values(output).every((items) => items.length === 0)
            ? withSuccessItems(input, output)
            : output;
      }
    },
  };
}
