import {
  LOOP_NODE_TYPES,
  analyzeLoops,
  resolveNodePorts,
  type WorkflowDefinition,
} from '@olly/shared-types';
import type { NodeRegistry } from '@olly/nodes';

export type IssueCode =
  | 'NODE_UNKNOWN_TYPE'
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_NODE_NAME'
  | 'EDGE_UNKNOWN_NODE'
  | 'EDGE_UNKNOWN_PORT'
  | 'INVALID_CYCLE'
  | 'ORPHAN_NODE'
  | 'EXPRESSION_NOT_ALLOWED';

export interface Issue {
  code: IssueCode;
  message: string;
  /** Nós envolvidos (FR-005): o editor os destaca. */
  nodeIds: string[];
}

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
}

type SchemaNode = {
  properties?: Record<string, unknown>;
  items?: unknown;
  'x-no-expression'?: boolean;
};

/**
 * Caminhos de parâmetros marcados com `x-no-expression` que receberam uma expressão (valor
 * iniciado por `=`), percorrendo objetos e listas (spec 004, FR-012).
 */
export function expressionsInStaticParams(schema: unknown, value: unknown, path = ''): string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const s = schema as SchemaNode;
  if (s['x-no-expression'] && typeof value === 'string' && value.startsWith('=')) return [path];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => expressionsInStaticParams(s.items, v, `${path}[${i}]`));
  }
  if (typeof value === 'object' && value !== null && s.properties) {
    return Object.entries(s.properties).flatMap(([key, sub]) =>
      expressionsInStaticParams(
        sub,
        (value as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      ),
    );
  }
  return [];
}

/**
 * Validação estrutural ao salvar (FR-004). Erros impedem o salvamento; avisos não.
 * A forma do JSON é validada antes pelo schema zod de `@olly/shared-types`.
 */
export function validateWorkflow(
  def: WorkflowDefinition,
  registry: NodeRegistry,
): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const nodesById = new Map(def.nodes.map((n) => [n.id, n]));

  const byId = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  for (const node of def.nodes) {
    byId.set(node.id, [...(byId.get(node.id) ?? []), node.id]);
    byName.set(node.name, [...(byName.get(node.name) ?? []), node.id]);
    const type = registry.get(node.type);
    if (!type) {
      errors.push({
        code: 'NODE_UNKNOWN_TYPE',
        message: `Nó "${node.name}": tipo desconhecido "${node.type}"`,
        nodeIds: [node.id],
      });
    }
    for (const path of expressionsInStaticParams(type?.paramsSchema, node.params)) {
      errors.push({
        code: 'EXPRESSION_NOT_ALLOWED',
        message: `Nó "${node.name}": o parâmetro "${path}" não aceita expressões`,
        nodeIds: [node.id],
      });
    }
  }
  for (const [id, ids] of byId) {
    if (ids.length > 1) {
      errors.push({
        code: 'DUPLICATE_NODE_ID',
        message: `Id de nó repetido: ${id}`,
        nodeIds: [id],
      });
    }
  }
  for (const [name, ids] of byName) {
    if (ids.length > 1) {
      errors.push({
        code: 'DUPLICATE_NODE_NAME',
        message: `Nome de nó repetido: "${name}"`,
        nodeIds: ids,
      });
    }
  }

  const validEdges: WorkflowDefinition['edges'] = [];
  for (const edge of def.edges) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) {
      const missing = [!from ? edge.from : null, !to ? edge.to : null].filter(
        (x): x is string => x !== null,
      );
      errors.push({
        code: 'EDGE_UNKNOWN_NODE',
        message: `Conexão ${edge.id} aponta para nó inexistente: ${missing.join(', ')}`,
        nodeIds: [from?.id, to?.id].filter((x): x is string => x !== undefined),
      });
      continue;
    }
    validEdges.push(edge);
    const fromType = registry.get(from.type);
    const toType = registry.get(to.type);
    // Portas efetivas: dinâmicas (Merge, Switch) e de erro (spec 007).
    if (
      fromType &&
      !resolveNodePorts(fromType, from).outputs.some((p) => p.name === edge.fromPort)
    ) {
      errors.push({
        code: 'EDGE_UNKNOWN_PORT',
        message: `Nó "${from.name}" não tem a saída "${edge.fromPort}"`,
        nodeIds: [from.id, to.id],
      });
    }
    if (toType && !resolveNodePorts(toType, to).inputs.some((p) => p.name === edge.toPort)) {
      errors.push({
        code: 'EDGE_UNKNOWN_PORT',
        message: `Nó "${to.name}" não tem a entrada "${edge.toPort}"`,
        nodeIds: [from.id, to.id],
      });
    }
  }

  // Spec 007, FR-008: ciclos só pela porta `continue` de um nó de laço que domina o ciclo.
  const { invalid } = analyzeLoops(
    [...nodesById.keys()],
    validEdges,
    (id) => LOOP_NODE_TYPES.includes(nodesById.get(id)?.type ?? ''),
    (id) => nodesById.get(id)?.name ?? id,
  );
  for (const cycle of invalid) {
    errors.push({ code: 'INVALID_CYCLE', message: cycle.reason, nodeIds: cycle.nodeIds });
  }

  if (def.nodes.length > 1) {
    const connected = new Set(validEdges.flatMap((e) => [e.from, e.to]));
    for (const node of def.nodes) {
      if (!connected.has(node.id)) {
        warnings.push({
          code: 'ORPHAN_NODE',
          message: `Nó "${node.name}" não está conectado`,
          nodeIds: [node.id],
        });
      }
    }
  }

  return { errors, warnings };
}
