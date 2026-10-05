import type { NodeDescription } from '@olly/nodes';
import { resolveNodePorts, type Edge, type WorkflowNode } from '@olly/shared-types';
import { useEditorStore, type EditorState } from './store';

type Patch = Parameters<EditorState['updateNode']>[1];

/** Conexões do nó cujas portas deixam de existir com a alteração (spec 007: portas dinâmicas). */
export function orphanEdges(
  description: NodeDescription,
  node: WorkflowNode,
  edges: Edge[],
): Edge[] {
  const { inputs, outputs } = resolveNodePorts(description, node);
  return edges.filter(
    (e) =>
      (e.to === node.id && !inputs.some((p) => p.name === e.toPort)) ||
      (e.from === node.id && !outputs.some((p) => p.name === e.fromPort)),
  );
}

/**
 * Altera o nó e, se portas deixarem de existir (Merge com menos entradas, Switch com menos
 * regras, sem saída de erro), confirma antes de remover as conexões órfãs no mesmo passo.
 * Devolve `false` se o usuário desistiu.
 */
export function updateNodeGuarded(
  description: NodeDescription | undefined,
  nodeId: string,
  patch: Patch,
  coalesceKey?: string,
  confirm: (message: string) => boolean = (m) => window.confirm(m),
): boolean {
  const store = useEditorStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node || !description) {
    store.updateNode(nodeId, patch, coalesceKey);
    return true;
  }
  const orphans = orphanEdges(description, { ...node, ...patch }, store.edges);
  if (
    orphans.length > 0 &&
    !confirm(
      `Esta alteração remove ${String(orphans.length)} ${orphans.length === 1 ? 'conexão' : 'conexões'} de portas que deixam de existir. Continuar?`,
    )
  ) {
    return false;
  }
  store.updateNode(
    nodeId,
    patch,
    coalesceKey,
    orphans.map((e) => e.id),
  );
  return true;
}
