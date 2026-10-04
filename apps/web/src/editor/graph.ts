import type { JSONSchema7 } from '@olly/nodes';
import type { Edge, WorkflowNode } from '@olly/shared-types';

/**
 * Nome único no workflow, no estilo do N8N: "Definir campos", "Definir campos1", "Definir campos2"...
 * Sufixos numéricos existentes são substituídos, não acumulados.
 */
export function uniqueName(desired: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(desired)) return desired;
  const root = desired.replace(/\d+$/, '');
  for (let i = 1; ; i++) {
    const candidate = `${root}${i}`;
    if (!names.has(candidate)) return candidate;
  }
}

/** Valores padrão do schema de parâmetros (só o primeiro nível). */
export function defaultParams(schema: JSONSchema7): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (typeof prop === 'object' && prop.default !== undefined)
      params[key] = structuredClone(prop.default);
  }
  return params;
}

export interface Clipboard {
  nodes: WorkflowNode[];
  edges: Edge[];
}

/** Copia os nós selecionados e as conexões entre eles. */
export function copySelection(
  nodes: WorkflowNode[],
  edges: Edge[],
  selectedIds: string[],
): Clipboard {
  const ids = new Set(selectedIds);
  return structuredClone({
    nodes: nodes.filter((n) => ids.has(n.id)),
    edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  });
}

/**
 * Prepara a colagem: novos ids, nomes únicos (caso de borda da spec 002) e posição deslocada.
 * As conexões internas acompanham os novos ids.
 */
export function prepareClipboardPaste(
  clipboard: Clipboard,
  existing: WorkflowNode[],
  newId: () => string,
  offset: [number, number] = [40, 40],
): Clipboard {
  const taken = new Set(existing.map((n) => n.name));
  const idMap = new Map<string, string>();
  const nodes = clipboard.nodes.map((node) => {
    const id = newId();
    idMap.set(node.id, id);
    const name = uniqueName(node.name, taken);
    taken.add(name);
    return {
      ...structuredClone(node),
      id,
      name,
      position: [node.position[0] + offset[0], node.position[1] + offset[1]] as [number, number],
    };
  });
  const edges = clipboard.edges.flatMap((edge) => {
    const from = idMap.get(edge.from);
    const to = idMap.get(edge.to);
    return from && to ? [{ ...edge, id: newId(), from, to }] : [];
  });
  return { nodes, edges };
}

/** Remove nós e as conexões que dependem deles. */
export function removeElements(
  nodes: WorkflowNode[],
  edges: Edge[],
  nodeIds: string[],
  edgeIds: string[],
): Clipboard {
  const removedNodes = new Set(nodeIds);
  const removedEdges = new Set(edgeIds);
  return {
    nodes: nodes.filter((n) => !removedNodes.has(n.id)),
    edges: edges.filter(
      (e) => !removedEdges.has(e.id) && !removedNodes.has(e.from) && !removedNodes.has(e.to),
    ),
  };
}
