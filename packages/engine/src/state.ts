import type { Item, NodeOutput, WorkflowDefinition } from '@olly/shared-types';

export type NodeRunStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'cancelled';

/**
 * Estado de uma porta de entrada (spec 006, plan §3): `unresolved` enquanto algum nó que a
 * alimenta não terminou; depois, `data` se chegou pelo menos um item, senão `noData`.
 */
export type PortState = 'unresolved' | 'data' | 'noData';

/** Prontidão de um nó pendente: aguardando, pronto para executar ou sem dados (pular). */
export type Readiness = 'waiting' | 'ready' | 'noData';

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

const FINISHED: ReadonlySet<NodeRunStatus> = new Set(['success', 'skipped', 'error', 'cancelled']);

/**
 * Estado de uma execução: status e saída de cada nó. A entrada de um nó é montada quando ele
 * fica pronto, a partir das saídas dos pais **na ordem das arestas na definição** (spec 006,
 * FR-008), nunca pela ordem em que os pais terminaram.
 */
export class ExecutionState implements RunView {
  readonly nodes = new Map<string, NodeRunState>();
  private readonly incoming = new Map<string, WorkflowDefinition['edges']>();

  constructor(def: WorkflowDefinition) {
    for (const node of def.nodes) {
      this.nodes.set(node.id, { inputs: {}, sources: {}, status: 'pending' });
      this.incoming.set(node.id, []);
    }
    for (const edge of def.edges) this.incoming.get(edge.to)?.push(edge);
  }

  get(nodeId: string): NodeRunState {
    const state = this.nodes.get(nodeId);
    if (!state) throw new Error(`Nó inexistente: ${nodeId}`);
    return state;
  }

  /** Nós que alimentam `nodeId`, na ordem das arestas. */
  sources(nodeId: string): string[] {
    return (this.incoming.get(nodeId) ?? []).map((e) => e.from);
  }

  isFinished(nodeId: string): boolean {
    return FINISHED.has(this.get(nodeId).status);
  }

  /** Estado de cada porta de entrada conectada (FR-007). */
  portStates(nodeId: string): Record<string, PortState> {
    const states: Record<string, PortState> = {};
    for (const edge of this.incoming.get(nodeId) ?? []) {
      const current = states[edge.toPort];
      const source = this.get(edge.from);
      if (!FINISHED.has(source.status)) {
        states[edge.toPort] = 'unresolved';
        continue;
      }
      if (current === 'unresolved') continue;
      const hasItems = (source.output?.[edge.fromPort]?.length ?? 0) > 0;
      states[edge.toPort] = hasItems || current === 'data' ? 'data' : 'noData';
    }
    return states;
  }

  /**
   * Prontidão (plan §3): todas as portas conectadas resolvidas e pelo menos uma com dados.
   * Todas sem dados: o nó é pulado e também não entrega dados aos seguintes.
   */
  readiness(nodeId: string): Readiness {
    if (this.get(nodeId).status !== 'pending') return 'waiting';
    const ports = Object.values(this.portStates(nodeId));
    if (ports.includes('unresolved')) return 'waiting';
    return ports.includes('data') ? 'ready' : 'noData';
  }

  isReady(nodeId: string): boolean {
    return this.readiness(nodeId) !== 'waiting';
  }

  /** Monta a entrada do nó a partir das saídas dos pais, na ordem das arestas (cópias). */
  collect(nodeId: string): void {
    const target = this.get(nodeId);
    const inputs: Record<string, Item[]> = {};
    const sources: Record<string, SourceRef[]> = {};
    for (const edge of this.incoming.get(nodeId) ?? []) {
      const items = this.get(edge.from).output?.[edge.fromPort] ?? [];
      inputs[edge.toPort] = [...(inputs[edge.toPort] ?? []), ...structuredClone(items)];
      sources[edge.toPort] = [
        ...(sources[edge.toPort] ?? []),
        ...items.map((_, index) => ({ nodeId: edge.from, port: edge.fromPort, index })),
      ];
    }
    target.inputs = inputs;
    target.sources = sources;
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
