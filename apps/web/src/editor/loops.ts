import {
  LOOP_CONTINUE_PORT,
  LOOP_NODE_TYPES,
  analyzeLoops,
  type Edge,
  type WorkflowNode,
} from '@olly/shared-types';

export interface EdgeLoopInfo {
  /** Arestas de retorno válidas (corpo → `continue` do nó de laço), com estilo próprio. */
  back: Set<string>;
  /** Arestas dentro de um ciclo inválido, com o motivo (tooltip, FR-016). */
  invalid: Map<string, string>;
}

/** Classifica as arestas para o desenho do canvas (spec 007, FR-016). */
export function edgeLoopInfo(nodes: WorkflowNode[], edges: Edge[]): EdgeLoopInfo {
  const analysis = loopAnalysisOf(nodes, edges);
  const invalid = new Map<string, string>();
  for (const cycle of analysis.invalid) {
    const members = new Set(cycle.nodeIds);
    for (const e of edges) {
      if (members.has(e.from) && members.has(e.to)) invalid.set(e.id, cycle.reason);
    }
  }
  return { back: analysis.backEdges, invalid };
}

function loopAnalysisOf(nodes: WorkflowNode[], edges: Edge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return analyzeLoops(
    nodes.map((n) => n.id),
    edges,
    (id) => LOOP_NODE_TYPES.includes(byId.get(id)?.type ?? ''),
    (id) => byId.get(id)?.name ?? id,
  );
}

/**
 * Motivo para recusar uma conexão nova que criaria um ciclo inválido (spec 007, FR-008/FR-016),
 * ou `null` se ela pode ser feita.
 */
export function invalidConnectionReason(
  nodes: WorkflowNode[],
  edges: Edge[],
  candidate: Omit<Edge, 'id'>,
): string | null {
  const before = new Set(loopAnalysisOf(nodes, edges).invalid.map((c) => c.nodeIds.join()));
  const after = loopAnalysisOf(nodes, [...edges, { ...candidate, id: '__nova__' }]).invalid;
  const created = after.find((c) => !before.has(c.nodeIds.join()));
  return created?.reason ?? null;
}

/** A porta de entrada é a volta de um laço (desenhada à parte). */
export const isLoopReturn = (node: WorkflowNode | undefined, port: string) =>
  port === LOOP_CONTINUE_PORT && LOOP_NODE_TYPES.includes(node?.type ?? '');
