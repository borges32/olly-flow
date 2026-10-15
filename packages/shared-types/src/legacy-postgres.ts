import type { WorkflowDefinition, WorkflowNode } from './workflow.js';

/** Tipo do nó PostgreSQL único (spec 022). */
export const POSTGRES_NODE_TYPE = 'postgres.database';

/**
 * Spec 022, FR-008: `postgres.query` e `postgres.write` (spec 004) viram o nó PostgreSQL único,
 * com a operação correspondente e as mesmas configurações. As opções vão para `queryOptions` ou
 * `writeOptions`. Pura e idempotente.
 */
export function migrateLegacyPostgresNode(node: WorkflowNode): WorkflowNode {
  if (node.type === 'postgres.query') {
    const { options, ...rest } = node.params;
    return {
      ...node,
      type: POSTGRES_NODE_TYPE,
      params: {
        operation: 'executeQuery',
        ...rest,
        ...(options !== undefined && { queryOptions: options }),
      },
    };
  }
  if (node.type === 'postgres.write') {
    const { options, operation, ...rest } = node.params;
    return {
      ...node,
      type: POSTGRES_NODE_TYPE,
      params: {
        operation: operation ?? 'insert',
        ...rest,
        ...(options !== undefined && { writeOptions: options }),
      },
    };
  }
  return node;
}

export function migrateLegacyPostgres<T extends WorkflowDefinition>(
  definition: T,
): { definition: T; changed: boolean } {
  if (!definition.nodes.some((n) => n.type === 'postgres.query' || n.type === 'postgres.write')) {
    return { definition, changed: false };
  }
  return {
    definition: { ...definition, nodes: definition.nodes.map(migrateLegacyPostgresNode) },
    changed: true,
  };
}
