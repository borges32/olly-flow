import type {
  ExecutionEvents,
  NodeFinishedEvent,
  NodeStartedEvent,
  StreamEvent,
  StreamNodeRef,
  WorkflowDefinition,
} from '@olly/shared-types';

const RESPOND_TO_WEBHOOK = 'http.respondToWebhook';

/** Linha NDJSON de um evento (spec 027, FR-001). */
export const ndjsonLine = (event: StreamEvent): string => `${JSON.stringify(event)}\n`;

/**
 * Converte os eventos de uma execução nos eventos do stream (spec 027, plan §1), só com
 * metadados (FR-003): o nome de cada nó vem da definição executada, como aparece no canvas
 * (FR-002). Guarda os nós em execução (para o `ping`), o último nó com dados e o nó
 * "Responder ao webhook" (para a resposta final).
 */
export class StreamTracker {
  private readonly nodes: Map<string, { name: string; type: string }>;
  private readonly running = new Map<string, StreamNodeRef>();
  private lastData?: StreamNodeRef;
  private responder?: StreamNodeRef;

  constructor(
    definition: WorkflowDefinition,
    readonly executionId: string,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.nodes = new Map(definition.nodes.map((n) => [n.id, { name: n.name, type: n.type }]));
  }

  private base() {
    return { executionId: this.executionId, timestamp: this.now() };
  }

  private ref(nodeId: string, runIndex: number): StreamNodeRef {
    const node = this.nodes.get(nodeId);
    return { nodeId, nodeName: node?.name ?? nodeId, nodeType: node?.type ?? '', runIndex };
  }

  /** A execução foi gravada e espera um worker (ou a vaga da cota). */
  queued(): StreamEvent {
    return { type: 'execution', metadata: { ...this.base(), status: 'queued' } };
  }

  waiting(): StreamEvent {
    return { type: 'execution', metadata: { ...this.base(), status: 'waiting' } };
  }

  ping(): StreamEvent {
    return { type: 'ping', metadata: { ...this.base(), running: [...this.running.values()] } };
  }

  /** Resposta final; `ref` é o nó que a produziu. */
  final(content: unknown, ref?: StreamNodeRef): StreamEvent {
    return { type: 'item', content, metadata: { ...this.base(), ...ref, final: true } };
  }

  error(message: string, nodeId?: string): StreamEvent {
    const ref = nodeId && this.nodes.has(nodeId) ? this.ref(nodeId, 0) : undefined;
    return { type: 'error', content: message, metadata: { ...this.base(), ...ref } };
  }

  /** Último nó que terminou com itens (o da resposta "último nó"). */
  get lastDataNode(): StreamNodeRef | undefined {
    return this.lastData;
  }

  get responderNode(): StreamNodeRef | undefined {
    return this.responder;
  }

  /** Eventos do stream para um evento da execução (nenhum, se não interessa). */
  handle<K extends keyof ExecutionEvents>(event: K, payload: ExecutionEvents[K]): StreamEvent[] {
    if (payload.executionId !== this.executionId) return [];
    switch (event) {
      case 'executionStarted':
        return [{ type: 'execution', metadata: { ...this.base(), status: 'started' } }];
      case 'nodeStarted': {
        const p = payload as NodeStartedEvent;
        const ref = this.ref(p.nodeId, p.runIndex);
        this.running.set(`${p.nodeId}#${String(p.runIndex)}`, ref);
        return [{ type: 'begin', metadata: { ...this.base(), ...ref, itemIndex: 0 } }];
      }
      case 'nodeFinished':
        return this.nodeFinished(payload as NodeFinishedEvent);
      default:
        return [];
    }
  }

  private nodeFinished(p: NodeFinishedEvent): StreamEvent[] {
    // Ramo sem itens: o nó não executou (e não teve início). Em espera: o fim vem na retomada.
    if (p.status === 'skipped' || p.status === 'waiting' || p.status === 'running') return [];
    const ref = this.ref(p.nodeId, p.runIndex);
    this.running.delete(`${p.nodeId}#${String(p.runIndex)}`);
    if (p.status === 'success') {
      if (p.itemsOut > 0) this.lastData = ref;
      if (ref.nodeType === RESPOND_TO_WEBHOOK) this.responder = ref;
    }
    return [
      {
        type: 'end',
        metadata: {
          ...this.base(),
          ...ref,
          itemIndex: 0,
          status: p.status,
          durationMs: p.durationMs,
          itemsIn: p.itemsIn,
          itemsOut: p.itemsOut,
        },
      },
    ];
  }
}
