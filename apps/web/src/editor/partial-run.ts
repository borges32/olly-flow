import type { Edge, Item, WorkflowNode } from '@olly/shared-types';
import type { NodeRunView } from './store';

/**
 * Assinatura do que determina a saída de um nó: tipo, parâmetros, desabilitado, configurações,
 * dados fixados e conexões de entrada. Mudou desde a execução → os dados dela estão velhos.
 */
export function nodeSignature(
  node: WorkflowNode,
  edges: Edge[],
  pinData: Record<string, Item[]>,
): string {
  const incoming = edges
    .filter((e) => e.to === node.id)
    .map((e) => `${e.from}:${e.fromPort}>${e.toPort}`)
    .sort();
  return JSON.stringify([
    node.type,
    node.params,
    node.disabled === true,
    node.credentialId ?? null,
    node.settings ?? null,
    pinData[node.id] ?? null,
    incoming,
  ]);
}

export function nodeSignatures(
  nodes: WorkflowNode[],
  edges: Edge[],
  pinData: Record<string, Item[]>,
): Record<string, string> {
  return Object.fromEntries(nodes.map((n) => [n.id, nodeSignature(n, edges, pinData)]));
}

function walk(start: string, edges: Edge[], direction: 'up' | 'down'): Set<string> {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const e of edges) {
      const [from, to] = direction === 'down' ? [e.from, e.to] : [e.to, e.from];
      if (from === id && !seen.has(to)) {
        seen.add(to);
        stack.push(to);
      }
    }
  }
  return seen;
}

/** O nó e todos os que dependem dele: os dados deles ficam velhos ao executá-lo. */
export const downstreamOf = (nodeId: string, edges: Edge[]) => walk(nodeId, edges, 'down');

/**
 * Execução de um nó (FR-020): para cada ancestral do destino que pode ser reaproveitado, a
 * execução de onde vêm os dados. Reaproveitável = sucesso na última execução, dados completos,
 * nó sem alteração desde então e todos os seus pais também reaproveitáveis. Os demais
 * ancestrais executam de novo.
 */
export function planReuse(
  destinationId: string,
  nodes: WorkflowNode[],
  edges: Edge[],
  pinData: Record<string, Item[]>,
  runNodes: Record<string, NodeRunView>,
): Record<string, string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, boolean>();
  const reusable = (id: string): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, false); // protege contra ciclo
    const node = byId.get(id);
    const view = runNodes[id];
    const ok =
      node !== undefined &&
      view?.status === 'success' &&
      !view.dataTruncated &&
      view.executionId !== undefined &&
      view.signature === nodeSignature(node, edges, pinData) &&
      edges.filter((e) => e.to === id).every((e) => reusable(e.from));
    memo.set(id, ok);
    return ok;
  };
  const plan: Record<string, string> = {};
  for (const id of walk(destinationId, edges, 'up')) {
    const executionId = runNodes[id]?.executionId;
    if (id !== destinationId && executionId && reusable(id)) plan[id] = executionId;
  }
  return plan;
}
