import type { WorkflowDefinition } from '@olly/shared-types';
import type { NodeRegistry } from '@olly/nodes';

export type IssueCode =
  | 'NODE_UNKNOWN_TYPE'
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_NODE_NAME'
  | 'EDGE_UNKNOWN_NODE'
  | 'EDGE_UNKNOWN_PORT'
  | 'CYCLE'
  | 'ORPHAN_NODE';

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

/** Componentes fortemente conexos com mais de um nó, ou nós com laço próprio (Tarjan). */
export function findCycles(nodeIds: string[], edges: { from: string; to: string }[]): string[][] {
  const adjacency = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) adjacency.get(e.from)?.push(e.to);

  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const strongConnect = (v: string): void => {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v) ?? 0, lowlink.get(w) ?? 0));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v) ?? 0, indices.get(w) ?? 0));
      }
    }
    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      const selfLoop = component.length === 1 && (adjacency.get(v) ?? []).includes(v);
      if (component.length > 1 || selfLoop) {
        cycles.push(nodeIds.filter((id) => component.includes(id)));
      }
    }
  };

  for (const id of nodeIds) if (!indices.has(id)) strongConnect(id);
  return cycles;
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
    if (!registry.get(node.type)) {
      errors.push({
        code: 'NODE_UNKNOWN_TYPE',
        message: `Nó "${node.name}": tipo desconhecido "${node.type}"`,
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

  const validEdges: { from: string; to: string }[] = [];
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
    if (fromType && !fromType.outputs.some((p) => p.name === edge.fromPort)) {
      errors.push({
        code: 'EDGE_UNKNOWN_PORT',
        message: `Nó "${from.name}" não tem a saída "${edge.fromPort}"`,
        nodeIds: [from.id, to.id],
      });
    }
    if (toType && !toType.inputs.some((p) => p.name === edge.toPort)) {
      errors.push({
        code: 'EDGE_UNKNOWN_PORT',
        message: `Nó "${to.name}" não tem a entrada "${edge.toPort}"`,
        nodeIds: [from.id, to.id],
      });
    }
  }

  for (const cycle of findCycles([...nodesById.keys()], validEdges)) {
    const names = cycle.map((id) => `"${nodesById.get(id)?.name ?? id}"`).join(' → ');
    errors.push({ code: 'CYCLE', message: `Ciclo entre os nós ${names}`, nodeIds: cycle });
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
