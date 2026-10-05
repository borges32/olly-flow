import type { NodeDescription } from '@olly/nodes';
import type {
  Edge,
  ExecutionDetail,
  ExecutionFinishedEvent,
  ExecutionStatus,
  Item,
  NodeExecutionError,
  NodeExecutionStatus,
  NodeFinishedEvent,
  NodeOutput,
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowIssue,
  WorkflowNode,
  WorkflowSettings,
} from '@olly/shared-types';
import { create } from 'zustand';
import {
  copySelection,
  defaultParams,
  prepareClipboardPaste,
  removeElements,
  uniqueName,
  type Clipboard,
} from './graph';
import { downstreamOf } from './partial-run';

const HISTORY_LIMIT = 100;

interface Snapshot {
  name: string;
  nodes: WorkflowNode[];
  edges: Edge[];
  pinData: Record<string, Item[]>;
}

/** Estado de um nó na última execução de teste (FR-012, FR-017). */
export interface NodeRunView {
  status: NodeExecutionStatus;
  itemsIn: number;
  itemsOut: number;
  /** Início (ISO), para a linha do tempo (spec 006, FR-013). */
  startedAt?: string;
  durationMs?: number;
  pinned: boolean;
  /** Saída reaproveitada de uma execução anterior (FR-020). */
  reused: boolean;
  dataTruncated: boolean;
  error: NodeExecutionError | null;
  input?: Record<string, Item[]>;
  output?: NodeOutput;
  /** Saída do `console` do nó de código (spec 005, FR-012). */
  console?: string[];
  /** Sem `execution:readData`, os dados não vêm (spec 005, FR-014). */
  dataRedacted?: boolean;
  /** Execução que produziu estes dados; pode ser anterior à corrente (FR-020). */
  executionId?: string;
  /** `nodeSignature` do nó quando executou: diferente da atual → dados velhos. */
  signature?: string;
}

export interface RunState {
  executionId: string | null;
  /** `cancelled`: interrompida (cancelamento ou timeout global, spec 006). */
  status: 'idle' | 'running' | 'success' | 'error' | 'cancelled';
  nodes: Record<string, NodeRunView>;
  error: string | null;
  /** Assinaturas dos nós no início da execução corrente. */
  signatures: Record<string, string>;
}

const IDLE_RUN: RunState = {
  executionId: null,
  status: 'idle',
  nodes: {},
  error: null,
  signatures: {},
};

export interface RunStart {
  /** Execução de um nó: mantém os dados dos nós que não dependem dele (FR-020). */
  destinationNodeId?: string;
  signatures?: Record<string, string>;
}

export interface Selection {
  nodeIds: string[];
  edgeIds: string[];
}

export interface EditorState {
  workflowId: string | null;
  name: string;
  baseVersion: number;
  nodes: WorkflowNode[];
  edges: Edge[];
  settings: WorkflowSettings;
  /** Dados fixados por id do nó (FR-016); salvos com o workflow. */
  pinData: Record<string, Item[]>;
  selection: Selection;
  past: Snapshot[];
  future: Snapshot[];
  /** Agrupa alterações seguidas do mesmo campo em um único passo de desfazer. */
  coalesceKey: string | null;
  dirty: boolean;
  errors: WorkflowIssue[];
  warnings: WorkflowIssue[];
  clipboard: Clipboard | null;
  /** Última execução de teste; não entra no histórico de desfazer. */
  run: RunState;
  /** Escuta do webhook de teste: até quando (ISO), ou `null` (spec 005, FR-007). */
  webhookListening: string | null;
  /** Assinaturas da definição escutada: o ▶ dos próximos nós reaproveita o Webhook (HU-2.1). */
  webhookSignatures: Record<string, string>;
  setWebhookListening(expiresAt: string | null, signatures?: Record<string, string>): void;

  load(workflow: WorkflowDetail): void;
  reset(): void;
  markSaved(workflow: WorkflowDetail): void;
  setIssues(errors: WorkflowIssue[]): void;
  /** Registra o estado atual no histórico antes de uma mudança (ex.: início de um arraste). */
  checkpoint(coalesceKey?: string): void;
  setName(name: string): void;
  addNode(type: NodeDescription, position: [number, number]): string;
  moveNodes(positions: Record<string, [number, number]>): void;
  connect(edge: Omit<Edge, 'id'>): void;
  updateNode(
    id: string,
    patch: Partial<
      Pick<WorkflowNode, 'name' | 'params' | 'disabled' | 'credentialId' | 'settings'>
    >,
    coalesceKey?: string,
  ): void;
  removeSelection(): void;
  removeEdge(edgeId: string): void;
  setSelection(selection: Selection): void;
  copy(): void;
  paste(): void;
  undo(): void;
  redo(): void;
  setPinData(nodeId: string, items: Item[] | null): void;
  definition(): WorkflowDefinition;
  runStarted(executionId: string, start?: RunStart): void;
  nodeStarted(executionId: string, nodeId: string, startedAt?: string): void;
  nodeFinished(event: NodeFinishedEvent): void;
  runFinished(event: ExecutionFinishedEvent): void;
  /** Completa o estado com a execução gravada (eventos perdidos antes de entrar na sala). */
  applyExecution(detail: ExecutionDetail): void;
  runFailed(message: string): void;
}

const newId = () => crypto.randomUUID();

/** Status da execução no editor: na fila ou em andamento continua `running`. */
function finalStatus(status: ExecutionStatus, current: RunState['status']): RunState['status'] {
  if (status === 'queued' || status === 'running' || status === 'waiting') {
    return current === 'idle' ? 'running' : current;
  }
  return status;
}
const snapshot = (s: EditorState): Snapshot =>
  structuredClone({ name: s.name, nodes: s.nodes, edges: s.edges, pinData: s.pinData });

const INITIAL = {
  workflowId: null,
  name: '',
  baseVersion: 0,
  nodes: [],
  edges: [],
  settings: {},
  pinData: {},
  selection: { nodeIds: [], edgeIds: [] },
  past: [],
  future: [],
  coalesceKey: null,
  dirty: false,
  errors: [],
  warnings: [],
  run: IDLE_RUN,
  webhookListening: null,
  webhookSignatures: {},
} satisfies Partial<EditorState>;

export const useEditorStore = create<EditorState>()((set, get) => {
  /** Aplica uma mudança registrando o passo de desfazer. */
  const commit = (change: Partial<EditorState>, coalesceKey?: string) => {
    const state = get();
    const coalesce = coalesceKey !== undefined && coalesceKey === state.coalesceKey;
    set({
      ...change,
      past: coalesce ? state.past : [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: [],
      coalesceKey: coalesceKey ?? null,
      dirty: true,
    });
  };

  return {
    ...INITIAL,
    clipboard: null,

    reset: () => {
      set(INITIAL);
    },

    load: (wf) => {
      set({
        workflowId: wf.id,
        name: wf.name,
        baseVersion: wf.version,
        nodes: wf.definition.nodes,
        edges: wf.definition.edges,
        settings: wf.definition.settings,
        pinData: wf.definition.pinData ?? {},
        selection: { nodeIds: [], edgeIds: [] },
        past: [],
        future: [],
        coalesceKey: null,
        dirty: false,
        errors: [],
        warnings: wf.warnings,
        run: IDLE_RUN,
        webhookListening: null,
      });
    },

    markSaved: (wf) => {
      set({
        baseVersion: wf.version,
        name: wf.name,
        dirty: false,
        errors: [],
        warnings: wf.warnings,
        coalesceKey: null,
      });
    },

    setIssues: (errors) => {
      set({ errors });
    },

    checkpoint: (coalesceKey) => {
      commit({}, coalesceKey);
    },

    setName: (name) => {
      commit({ name }, 'workflow-name');
    },

    addNode: (type, position) => {
      const id = newId();
      const node: WorkflowNode = {
        id,
        type: type.type,
        name: uniqueName(
          type.displayName,
          get().nodes.map((n) => n.name),
        ),
        params: defaultParams(type.paramsSchema),
        position,
      };
      commit({ nodes: [...get().nodes, node], selection: { nodeIds: [id], edgeIds: [] } });
      return id;
    },

    moveNodes: (positions) => {
      set((s) => ({
        nodes: s.nodes.map((n) => {
          const position = positions[n.id];
          return position ? { ...n, position } : n;
        }),
        dirty: true,
      }));
    },

    connect: (edge) => {
      const { edges } = get();
      const exists = edges.some(
        (e) =>
          e.from === edge.from &&
          e.to === edge.to &&
          e.fromPort === edge.fromPort &&
          e.toPort === edge.toPort,
      );
      if (!exists) commit({ edges: [...edges, { ...edge, id: newId() }] });
    },

    updateNode: (id, patch, coalesceKey) => {
      const apply = (n: WorkflowNode): WorkflowNode => {
        const next = { ...n, ...patch };
        // `undefined` remove o campo (ex.: tirar a credencial do nó).
        if ('credentialId' in patch && patch.credentialId === undefined) delete next.credentialId;
        if ('settings' in patch && patch.settings === undefined) delete next.settings;
        return next;
      };
      commit({ nodes: get().nodes.map((n) => (n.id === id ? apply(n) : n)) }, coalesceKey);
    },

    removeSelection: () => {
      const { nodes, edges, selection, pinData } = get();
      if (selection.nodeIds.length === 0 && selection.edgeIds.length === 0) return;
      const removed = new Set(selection.nodeIds);
      commit({
        ...removeElements(nodes, edges, selection.nodeIds, selection.edgeIds),
        pinData: Object.fromEntries(Object.entries(pinData).filter(([id]) => !removed.has(id))),
        selection: { nodeIds: [], edgeIds: [] },
      });
    },

    removeEdge: (edgeId) => {
      const { edges, selection } = get();
      if (!edges.some((e) => e.id === edgeId)) return;
      commit({
        edges: edges.filter((e) => e.id !== edgeId),
        selection: { ...selection, edgeIds: selection.edgeIds.filter((id) => id !== edgeId) },
      });
    },

    setPinData: (nodeId, items) => {
      const rest = Object.fromEntries(
        Object.entries(get().pinData).filter(([id]) => id !== nodeId),
      );
      commit({ pinData: items ? { ...rest, [nodeId]: structuredClone(items) } : rest });
    },

    definition: () => {
      const s = get();
      return {
        nodes: s.nodes,
        edges: s.edges,
        settings: s.settings,
        ...(Object.keys(s.pinData).length > 0 && { pinData: s.pinData }),
      };
    },

    runStarted: (executionId, start = {}) => {
      const { run, edges } = get();
      let nodes: Record<string, NodeRunView> = {};
      if (start.destinationNodeId) {
        const stale = downstreamOf(start.destinationNodeId, edges);
        nodes = Object.fromEntries(Object.entries(run.nodes).filter(([id]) => !stale.has(id)));
      }
      set({
        run: {
          executionId,
          status: 'running',
          nodes,
          error: null,
          signatures: start.signatures ?? {},
        },
      });
    },

    nodeStarted: (executionId, nodeId, startedAt) => {
      const { run } = get();
      if (run.executionId !== executionId) return;
      set({
        run: {
          ...run,
          nodes: {
            ...run.nodes,
            [nodeId]: {
              status: 'running',
              startedAt: startedAt ?? new Date().toISOString(),
              itemsIn: 0,
              itemsOut: 0,
              pinned: false,
              reused: false,
              dataTruncated: false,
              error: null,
            },
          },
        },
      });
    },

    nodeFinished: (e) => {
      const { run } = get();
      if (run.executionId !== e.executionId) return;
      const started = run.nodes[e.nodeId];
      set({
        run: {
          ...run,
          nodes: {
            ...run.nodes,
            [e.nodeId]: {
              status: e.status,
              startedAt:
                started?.status === 'running' && started.startedAt
                  ? started.startedAt
                  : new Date(Date.now() - e.durationMs).toISOString(),
              itemsIn: e.itemsIn,
              itemsOut: e.itemsOut,
              durationMs: e.durationMs,
              pinned: e.pinned,
              reused: e.reused,
              dataTruncated: e.dataTruncated,
              error: e.error,
              input: e.data.input,
              output: e.data.output,
              ...(e.console && { console: e.console }),
              ...(e.dataRedacted && { dataRedacted: true }),
              executionId: e.executionId,
              ...(run.signatures[e.nodeId] !== undefined && {
                signature: run.signatures[e.nodeId],
              }),
            },
          },
        },
      });
    },

    runFinished: (e) => {
      const { run } = get();
      if (run.executionId !== e.executionId) return;
      set({
        run: {
          ...run,
          status: finalStatus(e.status, run.status),
          error: e.error?.message ?? null,
        },
      });
    },

    applyExecution: (detail) => {
      const { run } = get();
      if (run.executionId !== detail.id) return;
      const nodes = { ...run.nodes };
      for (const n of detail.nodes) {
        nodes[n.nodeId] = {
          status: n.status,
          startedAt: n.startedAt,
          itemsIn: n.itemsIn,
          itemsOut: n.itemsOut,
          ...(n.finishedAt && {
            durationMs: new Date(n.finishedAt).getTime() - new Date(n.startedAt).getTime(),
          }),
          pinned: n.pinned,
          reused: n.reused,
          dataTruncated: n.dataTruncated,
          error: n.error,
          ...(n.input && { input: n.input }),
          ...(n.output && { output: n.output }),
          ...(n.console && { console: n.console }),
          ...(detail.dataRedacted && { dataRedacted: true }),
          executionId: detail.id,
          ...(run.signatures[n.nodeId] !== undefined && { signature: run.signatures[n.nodeId] }),
        };
      }
      const status = finalStatus(detail.status, run.status);
      set({ run: { ...run, nodes, status, error: detail.error?.message ?? run.error } });
    },

    runFailed: (message) => {
      set({ run: { ...get().run, status: 'error', error: message } });
    },

    setWebhookListening: (expiresAt, signatures) => {
      set({
        webhookListening: expiresAt,
        ...(signatures && { webhookSignatures: signatures }),
      });
    },

    setSelection: (selection) => {
      set({ selection });
    },

    copy: () => {
      const { nodes, edges, selection } = get();
      if (selection.nodeIds.length > 0)
        set({ clipboard: copySelection(nodes, edges, selection.nodeIds) });
    },

    paste: () => {
      const { clipboard, nodes, edges } = get();
      if (!clipboard || clipboard.nodes.length === 0) return;
      const pasted = prepareClipboardPaste(clipboard, nodes, newId);
      commit({
        nodes: [...nodes, ...pasted.nodes],
        edges: [...edges, ...pasted.edges],
        selection: { nodeIds: pasted.nodes.map((n) => n.id), edgeIds: [] },
      });
      // Colar de novo desloca a partir da última cópia, sem empilhar no mesmo lugar.
      set({ clipboard: { nodes: pasted.nodes, edges: pasted.edges } });
    },

    undo: () => {
      const state = get();
      const previous = state.past.at(-1);
      if (!previous) return;
      set({
        ...previous,
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future],
        coalesceKey: null,
        dirty: true,
        selection: { nodeIds: [], edgeIds: [] },
      });
    },

    redo: () => {
      const state = get();
      const [next, ...rest] = state.future;
      if (!next) return;
      set({
        ...next,
        past: [...state.past, snapshot(state)],
        future: rest,
        coalesceKey: null,
        dirty: true,
        selection: { nodeIds: [], edgeIds: [] },
      });
    },
  };
});
