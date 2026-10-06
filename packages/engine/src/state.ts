import {
  LOOP_CONTINUE_PORT,
  type Edge,
  type Item,
  type LoopAnalysis,
  type LoopInfo,
  type NodeOutput,
  type WorkflowDefinition,
} from '@olly/shared-types';

export type NodeRunStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'skipped'
  | 'cancelled'
  // Spec 008, FR-012: o nó pediu espera (Wait, aprovação humana); não conta como terminado.
  | 'waiting';

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

/** Estado serializável (spec 008, FR-012): o que a retomada precisa para continuar. */
export interface StateSnapshot {
  nodes: Record<
    string,
    {
      inputs: Record<string, Item[]>;
      sources: Record<string, SourceRef[]>;
      status: NodeRunStatus;
      output?: NodeOutput;
      pinned?: boolean;
      reused?: boolean;
    }
  >;
  runCounts: Record<string, number>;
  active: string[];
}

const EMPTY_LOOPS: LoopAnalysis = { loops: [], invalid: [], backEdges: new Set() };

/**
 * Estado de uma execução: status e saída corrente de cada nó. A entrada de um nó é montada
 * quando ele fica pronto, a partir das saídas dos pais **na ordem das arestas na definição**
 * (spec 006, FR-008), nunca pela ordem em que os pais terminaram.
 *
 * Laços (spec 007, plan §2): as arestas de retorno (para a porta `continue`) não contam na
 * prontidão comum. Enquanto um laço está ativo, quem está fora dele não enxerga o corpo nem a
 * saída `done` como resolvidos; a cada volta, o corpo é reaberto (estado limpo), e a saída
 * corrente de cada nó do corpo é sempre a da iteração atual.
 */
export class ExecutionState implements RunView {
  readonly nodes = new Map<string, NodeRunState>();
  private readonly incoming = new Map<string, Edge[]>();
  private readonly loopsByHeader = new Map<string, LoopInfo>();
  /** Laços que contêm cada nó (como membro), do mais externo ao mais interno. */
  private readonly loopsOfNode = new Map<string, LoopInfo[]>();
  /** Laços em andamento (emitiram `loop` e ainda não `done`). */
  readonly active = new Set<string>();
  /** Execuções já registradas por nó (o próximo `runIndex`). */
  private readonly runCounts = new Map<string, number>();

  constructor(
    def: WorkflowDefinition,
    private readonly loops: LoopAnalysis = EMPTY_LOOPS,
  ) {
    for (const node of def.nodes) {
      this.nodes.set(node.id, { inputs: {}, sources: {}, status: 'pending' });
      this.incoming.set(node.id, []);
    }
    for (const edge of def.edges) this.incoming.get(edge.to)?.push(edge);
    const bySize = [...loops.loops].sort((a, b) => b.members.size - a.members.size);
    for (const loop of bySize) {
      this.loopsByHeader.set(loop.header, loop);
      for (const id of loop.members) {
        this.loopsOfNode.set(id, [...(this.loopsOfNode.get(id) ?? []), loop]);
      }
    }
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

  isBackEdge(edge: Edge): boolean {
    return this.loops.backEdges.has(edge.id);
  }

  loopOf(header: string): LoopInfo | undefined {
    return this.loopsByHeader.get(header);
  }

  /** O laço mais interno que contém o nó (inclusive o próprio nó de laço). */
  innermostLoop(nodeId: string): LoopInfo | undefined {
    return this.loopsOfNode.get(nodeId)?.at(-1);
  }

  /** O nó está dentro de algum laço (nunca reaproveita saída anterior, FR-020). */
  inLoop(nodeId: string): boolean {
    return (this.loopsOfNode.get(nodeId)?.length ?? 0) > 0;
  }

  /** Próximo índice de execução do nó (FR-009). */
  nextRunIndex(nodeId: string): number {
    const n = this.runCounts.get(nodeId) ?? 0;
    this.runCounts.set(nodeId, n + 1);
    return n;
  }

  /** A aresta atravessa a fronteira de um laço ativo (de dentro para fora): ainda não resolvida. */
  private blocked(edge: Edge): boolean {
    return (this.loopsOfNode.get(edge.from) ?? []).some(
      (loop) => this.active.has(loop.header) && !loop.members.has(edge.to),
    );
  }

  /** Estado de cada porta de entrada conectada (FR-007), sem as arestas de retorno. */
  portStates(nodeId: string): Record<string, PortState> {
    const states: Record<string, PortState> = {};
    for (const edge of this.incoming.get(nodeId) ?? []) {
      if (this.isBackEdge(edge)) continue;
      const current = states[edge.toPort];
      const source = this.get(edge.from);
      if (!FINISHED.has(source.status) || this.blocked(edge)) {
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

  /**
   * O nó de laço pode receber a volta (`continue`): o laço está ativo, o nó não está executando
   * e o corpo terminou a iteração (todos os nós finalizados, sem laço interno ativo).
   */
  continueReady(header: string): boolean {
    const loop = this.loopsByHeader.get(header);
    if (!loop || !this.active.has(header) || this.get(header).status !== 'success') return false;
    for (const id of loop.body) {
      if (!this.isFinished(id) || this.active.has(id)) return false;
    }
    return true;
  }

  /**
   * Monta a entrada do nó a partir das saídas dos pais, na ordem das arestas (cópias). Para o
   * nó de laço, `continue` usa só as arestas de retorno; o normal, as demais.
   */
  collect(nodeId: string, which: 'normal' | 'continue' = 'normal'): void {
    const target = this.get(nodeId);
    const inputs: Record<string, Item[]> = {};
    const sources: Record<string, SourceRef[]> = {};
    for (const edge of this.incoming.get(nodeId) ?? []) {
      const back = this.isBackEdge(edge);
      if ((which === 'continue') !== back) continue;
      const port = back ? LOOP_CONTINUE_PORT : edge.toPort;
      const items = this.get(edge.from).output?.[edge.fromPort] ?? [];
      inputs[port] = [...(inputs[port] ?? []), ...structuredClone(items)];
      sources[port] = [
        ...(sources[port] ?? []),
        ...items.map((_, index) => ({ nodeId: edge.from, port: edge.fromPort, index })),
      ];
    }
    if (which === 'continue') inputs[LOOP_CONTINUE_PORT] ??= [];
    target.inputs = inputs;
    target.sources = sources;
  }

  /** Nova volta do laço: o corpo (e os laços aninhados) recomeça do zero. */
  openIteration(header: string): void {
    const loop = this.loopsByHeader.get(header);
    if (!loop) return;
    for (const id of loop.body) {
      this.nodes.set(id, { inputs: {}, sources: {}, status: 'pending' });
      this.active.delete(id);
    }
  }

  /** Cópia serializável do estado (sem erros: a execução que espera não falhou). */
  snapshot(): StateSnapshot {
    const nodes: StateSnapshot['nodes'] = {};
    for (const [id, n] of this.nodes) {
      nodes[id] = {
        inputs: n.inputs,
        sources: n.sources,
        status: n.status,
        ...(n.output && { output: n.output }),
        ...(n.pinned && { pinned: true }),
        ...(n.reused && { reused: true }),
      };
    }
    return structuredClone({
      nodes,
      runCounts: Object.fromEntries(this.runCounts),
      active: [...this.active],
    });
  }

  /** Restaura um estado salvo pela mesma definição (retomada, spec 008). */
  restore(snapshot: StateSnapshot): void {
    for (const [id, saved] of Object.entries(snapshot.nodes)) {
      if (!this.nodes.has(id)) continue;
      this.nodes.set(id, structuredClone(saved));
    }
    this.runCounts.clear();
    for (const [id, n] of Object.entries(snapshot.runCounts)) this.runCounts.set(id, n);
    this.active.clear();
    for (const id of snapshot.active) this.active.add(id);
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
