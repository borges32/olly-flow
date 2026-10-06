import type { NodeDescription } from '@olly/nodes';
import {
  resolveNodePorts,
  SUBNODE_PORT_KINDS,
  type Edge,
  type PortDef,
  type SubNodePortKind,
  type WorkflowNode,
} from '@olly/shared-types';

type Types = ReadonlyMap<string, NodeDescription>;

/** Porta `ai_*` de sub-nó (modelo, memória, ferramenta), desenhada na vertical (spec 011). */
export const isSubNodePort = (port: Pick<PortDef, 'kind'>): boolean =>
  (SUBNODE_PORT_KINDS as readonly string[]).includes(port.kind);

const KIND_LABEL: Record<SubNodePortKind, string> = {
  ai_languageModel: 'modelo',
  ai_memory: 'memória',
  ai_tool: 'ferramenta',
};

function portOf(
  types: Types,
  nodes: WorkflowNode[],
  nodeId: string,
  side: 'inputs' | 'outputs',
  name: string,
): PortDef | undefined {
  const node = nodes.find((n) => n.id === nodeId);
  const type = node && types.get(node.type);
  if (!node || !type) return undefined;
  return resolveNodePorts(type, node)[side].find((p) => p.name === name);
}

/** A conexão liga um sub-nó ao nó pai (desenhada tracejada). */
export function isSubNodeEdge(types: Types, nodes: WorkflowNode[], edge: Edge): boolean {
  const port = portOf(types, nodes, edge.to, 'inputs', edge.toPort);
  return port !== undefined && isSubNodePort(port);
}

/**
 * Motivo para recusar a conexão no canvas (spec 011, FR-001), ou `null`: as portas precisam
 * ser do mesmo tipo (sub-nó só na base do Agent, nunca no fluxo principal) e a porta de
 * destino respeita o máximo de conexões (1 modelo, 1 memória).
 */
export function connectionRejection(
  types: Types,
  nodes: WorkflowNode[],
  edges: Edge[],
  edge: Omit<Edge, 'id'>,
): string | null {
  if (edge.from === edge.to) return 'Um nó não se conecta a ele mesmo';
  const source = portOf(types, nodes, edge.from, 'outputs', edge.fromPort);
  const target = portOf(types, nodes, edge.to, 'inputs', edge.toPort);
  if (!source || !target) return null;
  if (source.kind !== target.kind) {
    if (isSubNodePort(source) && !isSubNodePort(target)) {
      return 'Sub-nós (modelo, memória, ferramenta) só se conectam à base do Agent';
    }
    if (isSubNodePort(target)) {
      return `Esta entrada aceita só ${KIND_LABEL[target.kind as SubNodePortKind]}`;
    }
    return 'As portas são de tipos diferentes';
  }
  if (target.maxConnections !== undefined) {
    const used = edges.filter(
      (e) => e.to === edge.to && e.toPort === edge.toPort && e.from !== edge.from,
    ).length;
    if (used >= target.maxConnections) {
      return `A entrada "${target.displayName ?? target.name}" aceita no máximo ${String(target.maxConnections)} ${target.maxConnections === 1 ? 'conexão' : 'conexões'}`;
    }
  }
  return null;
}
