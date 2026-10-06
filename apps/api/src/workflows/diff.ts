import type {
  Edge,
  JsonPatchOperation,
  NodeChange,
  WorkflowDefinition,
  WorkflowDiff,
  WorkflowNode,
} from '@olly/shared-types';
import fastJsonPatch from 'fast-json-patch';

const { compare } = fastJsonPatch;

// `compare` só produz add/remove/replace; o tipo da biblioteca inclui operações internas.
const patch = (from: object | undefined, to: object | undefined): JsonPatchOperation[] =>
  compare(from ?? {}, to ?? {}) as JsonPatchOperation[];

/** Arestas são iguais quando ligam as mesmas portas (o id pode mudar ao recriar). */
const edgeKey = (e: Edge) => `${e.from}:${e.fromPort}->${e.to}:${e.toPort}`;

/**
 * Diff estruturado entre duas versões (spec 009, FR-008; plan §3): nós e arestas adicionados,
 * removidos e alterados, com JSON Patch (RFC 6902) dos parâmetros e das configurações de cada nó.
 * Nós são comparados pelo id (renomear não é remover e adicionar).
 */
export function diffDefinitions(
  fromVersion: number,
  from: WorkflowDefinition,
  toVersion: number,
  to: WorkflowDefinition,
): WorkflowDiff {
  const before = new Map(from.nodes.map((n) => [n.id, n]));
  const after = new Map(to.nodes.map((n) => [n.id, n]));
  const added = to.nodes.filter((n) => !before.has(n.id));
  const removed = from.nodes.filter((n) => !after.has(n.id));
  const changed: NodeChange[] = [];
  for (const node of to.nodes) {
    const old = before.get(node.id);
    if (!old) continue;
    const change = nodeChange(old, node);
    if (change) changed.push(change);
  }
  const edgesBefore = new Set(from.edges.map(edgeKey));
  const edgesAfter = new Set(to.edges.map(edgeKey));
  return {
    from: fromVersion,
    to: toVersion,
    nodes: { added, removed, changed },
    edges: {
      added: to.edges.filter((e) => !edgesBefore.has(edgeKey(e))),
      removed: from.edges.filter((e) => !edgesAfter.has(edgeKey(e))),
    },
    settings: patch(from.settings, to.settings),
  };
}

function nodeChange(old: WorkflowNode, node: WorkflowNode): NodeChange | null {
  const params = patch(old.params, node.params);
  const settings = patch(old.settings, node.settings);
  const other = patch(
    { credentialId: old.credentialId, disabled: old.disabled ?? false },
    { credentialId: node.credentialId, disabled: node.disabled ?? false },
  );
  const moved = old.position[0] !== node.position[0] || old.position[1] !== node.position[1];
  const renamed = old.name !== node.name;
  const retyped = old.type !== node.type;
  if (!params.length && !settings.length && !other.length && !moved && !renamed && !retyped) {
    return null;
  }
  return {
    id: node.id,
    name: node.name,
    ...(renamed && { previousName: old.name }),
    ...(retyped && { type: { from: old.type, to: node.type } }),
    params,
    settings,
    other,
    ...(moved && { position: { from: old.position, to: node.position } }),
  };
}
