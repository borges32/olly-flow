import type { Item, NodeOutput, WorkflowDefinition } from '@olly/shared-types';

export type NodeRunStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

/** De onde veio um item de entrada: nó, porta de saída e índice na saída. */
export interface SourceRef {
  nodeId: string;
  port: string;
  index: number;
}

export interface NodeRunState {
  inputs: Record<string, Item[]>;
  /** Origem de cada item de `inputs`, na mesma posição. */
  sources: Record<string, SourceRef[]>;
  status: NodeRunStatus;
  output?: NodeOutput;
  error?: Error;
  pinned?: boolean;
  /** Saída reaproveitada de uma execução anterior (FR-020). */
  reused?: boolean;
}

/** Leitura dos dados de uma execução (em andamento ou reconstruída do log). */
export interface RunView {
  inputsOf(nodeId: string): Record<string, Item[]> | undefined;
  sourcesOf(nodeId: string): Record<string, SourceRef[]> | undefined;
  outputOf(nodeId: string): NodeOutput | undefined;
  isExecuted(nodeId: string): boolean;
}

/**
 * Estado de uma execução: entradas acumuladas por porta e status de cada nó. Um nó fica
 * pronto quando todos os nós que o alimentam já terminaram (com dados ou sem dados).
 */
export class ExecutionState implements RunView {
  readonly nodes = new Map<string, NodeRunState>();
  private readonly incoming = new Map<string, string[]>();

  constructor(private readonly def: WorkflowDefinition) {
    for (const node of def.nodes) {
      this.nodes.set(node.id, { inputs: {}, sources: {}, status: 'pending' });
      this.incoming.set(node.id, []);
    }
    for (const edge of def.edges) this.incoming.get(edge.to)?.push(edge.from);
  }

  get(nodeId: string): NodeRunState {
    const state = this.nodes.get(nodeId);
    if (!state) throw new Error(`Nó inexistente: ${nodeId}`);
    return state;
  }

  sources(nodeId: string): string[] {
    return this.incoming.get(nodeId) ?? [];
  }

  isFinished(nodeId: string): boolean {
    const { status } = this.get(nodeId);
    return status === 'success' || status === 'skipped' || status === 'error';
  }

  isReady(nodeId: string): boolean {
    return (
      this.get(nodeId).status === 'pending' && this.sources(nodeId).every((s) => this.isFinished(s))
    );
  }

  /** Entrega a saída do nó às arestas que partem dele. Cada destino recebe sua própria cópia. */
  deliver(nodeId: string, output: NodeOutput): void {
    for (const edge of this.def.edges) {
      if (edge.from !== nodeId) continue;
      const items = output[edge.fromPort] ?? [];
      const target = this.get(edge.to);
      target.inputs[edge.toPort] = [
        ...(target.inputs[edge.toPort] ?? []),
        ...structuredClone(items),
      ];
      target.sources[edge.toPort] = [
        ...(target.sources[edge.toPort] ?? []),
        ...items.map((_, index) => ({ nodeId, port: edge.fromPort, index })),
      ];
    }
  }

  inputsOf(nodeId: string): Record<string, Item[]> | undefined {
    return this.nodes.get(nodeId)?.inputs;
  }

  sourcesOf(nodeId: string): Record<string, SourceRef[]> | undefined {
    return this.nodes.get(nodeId)?.sources;
  }

  outputOf(nodeId: string): NodeOutput | undefined {
    return this.nodes.get(nodeId)?.output;
  }

  isExecuted(nodeId: string): boolean {
    return this.nodes.get(nodeId)?.status === 'success';
  }
}
