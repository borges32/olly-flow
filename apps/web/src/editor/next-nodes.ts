import type { Edge, NodeExecutionStatus, WorkflowNode } from '@olly/shared-types';
import type { RunState } from './store';

export interface NextNodesInput {
  nodes: WorkflowNode[];
  edges: Edge[];
  run: Pick<RunState, 'status' | 'nodes'>;
  /** Conexão de sub-nó (modelo, memória...): executa junto com o pai, não é um passo. */
  isSubNodeEdge: (edge: Edge) => boolean;
}

export interface NextNodes {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

/** Já executou com os dados atuais; `skipped` e `cancelled` ainda podem executar. */
const EXECUTED: readonly NodeExecutionStatus[] = ['success', 'error', 'running', 'waiting'];

/**
 * Nós que esperam a execução no teste nó a nó (spec 024, FR-001 a FR-003): ainda não executaram e
 * recebem uma conexão principal de uma saída com itens de um nó executado com sucesso. Ramos sem
 * itens (If, Switch, saída de erro) não contam.
 */
export function nextNodes({ nodes, edges, run, isSubNodeEdge }: NextNodesInput): NextNodes {
  const result: NextNodes = { nodeIds: new Set(), edgeIds: new Set() };
  if (run.status === 'idle' || run.status === 'running') return result;
  const ids = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || isSubNodeEdge(edge)) continue;
    const source = run.nodes[edge.from];
    if (source?.status !== 'success') continue;
    // Sem os dados (sem execution:readData), só se sabe que o nó teve itens.
    const hasItems = source.output
      ? (source.output[edge.fromPort]?.length ?? 0) > 0
      : source.itemsOut > 0;
    if (!hasItems) continue;
    const target = run.nodes[edge.to];
    if (target && EXECUTED.includes(target.status)) continue;
    result.nodeIds.add(edge.to);
    result.edgeIds.add(edge.id);
  }
  return result;
}
