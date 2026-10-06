import type {
  Edge,
  JsonPatchOperation,
  WorkflowDefinition,
  WorkflowDiff,
  WorkflowNode,
} from '@olly/shared-types';

export type DiffStatus = 'added' | 'removed' | 'changed';

export interface DiffCanvas {
  nodes: { node: WorkflowNode; status?: DiffStatus }[];
  edges: { edge: Edge; status?: Exclude<DiffStatus, 'changed'> }[];
}

/**
 * Canvas da comparação (spec 009, FR-010): os nós da versão de destino, com os adicionados e os
 * alterados marcados, mais os removidos como "fantasmas" na posição antiga. Arestas removidas
 * também aparecem (as de nós que ainda existem ou dos fantasmas).
 */
export function diffCanvas(
  diff: WorkflowDiff,
  from: WorkflowDefinition,
  to: WorkflowDefinition,
): DiffCanvas {
  const added = new Set(diff.nodes.added.map((n) => n.id));
  const changed = new Set(diff.nodes.changed.map((c) => c.id));
  const removedEdges = new Set(diff.edges.removed.map((e) => e.id));
  const addedEdges = new Set(diff.edges.added.map((e) => e.id));
  const nodes: DiffCanvas['nodes'] = [
    ...to.nodes.map((node) => ({
      node,
      ...(added.has(node.id)
        ? { status: 'added' as const }
        : changed.has(node.id)
          ? { status: 'changed' as const }
          : {}),
    })),
    ...diff.nodes.removed.map((node) => ({ node, status: 'removed' as const })),
  ];
  const ids = new Set(nodes.map((n) => n.node.id));
  const edges: DiffCanvas['edges'] = [
    ...to.edges.map((edge) => ({
      edge,
      ...(addedEdges.has(edge.id) && { status: 'added' as const }),
    })),
    ...from.edges
      .filter((e) => removedEdges.has(e.id) && ids.has(e.from) && ids.has(e.to))
      // Uma aresta removida pode ter o mesmo id de uma da versão nova: prefixo para o canvas.
      .map((edge) => ({ edge: { ...edge, id: `removed:${edge.id}` }, status: 'removed' as const })),
  ];
  return { nodes, edges };
}

/** Valor em um JSON Pointer (RFC 6901). */
export function valueAt(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  let current: unknown = root;
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const show = (v: unknown) => (v === undefined ? '∅' : JSON.stringify(v));

/** Linha legível de uma operação do patch: `caminho: antes → depois`. */
export function describePatch(op: JsonPatchOperation, before: unknown): string {
  const path = op.path.split('/').slice(1).join('.') || '(raiz)';
  if (op.op === 'add') return `${path}: + ${show(op.value)}`;
  if (op.op === 'remove') return `${path}: − ${show(valueAt(before, op.path))}`;
  return `${path}: ${show(valueAt(before, op.path))} → ${show(op.value)}`;
}
