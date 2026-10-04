import type { NodeDescription } from '@olly/nodes';
import type {
  Edge,
  ExecutionDetail,
  ExecutionFinishedEvent,
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
  durationMs?: number;
  pinned: boolean;
  dataTruncated: boolean;
  error: NodeExecutionError | null;
  input?: Record<string, Item[]>;
  output?: NodeOutput;
}

export interface RunState {
  executionId: string | null;
  status: 'idle' | 'running' | 'success' | 'error';
  nodes: Record<string, NodeRunView>;
  error: string | null;
}

const IDLE_RUN: RunState = { executionId: null, status: 'idle', nodes: {}, error: null };

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
    patch: Partial<Pick<WorkflowNode, 'name' | 'params' | 'disabled'>>,
    coalesceKey?: string,
  ): void;
  removeSelection(): void;
  setSelection(selection: Selection): void;
  copy(): void;
  paste(): void;
  undo(): void;
  redo(): void;
  setPinData(nodeId: string, items: Item[] | null): void;
  definition(): WorkflowDefinition;
  runStarted(executionId: string): void;
  nodeStarted(executionId: string, nodeId: string): void;
  nodeFinished(event: NodeFinishedEvent): void;
  runFinished(event: ExecutionFinishedEvent): void;
  /** Completa o estado com a execução gravada (eventos perdidos antes de entrar na sala). */
  applyExecution(detail: ExecutionDetail): void;
  runFailed(message: string): void;
}

const newId = () => crypto.randomUUID();
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
      commit(
        { nodes: get().nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) },
        coalesceKey,
      );
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

    runStarted: (executionId) => {
      set({ run: { executionId, status: 'running', nodes: {}, error: null } });
    },

    nodeStarted: (executionId, nodeId) => {
      const { run } = get();
      if (run.executionId !== executionId) return;
      set({
        run: {
          ...run,
          nodes: {
            ...run.nodes,
            [nodeId]: {
              status: 'running',
              itemsIn: 0,
              itemsOut: 0,
              pinned: false,
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
      set({
        run: {
          ...run,
          nodes: {
            ...run.nodes,
            [e.nodeId]: {
              status: e.status,
              itemsIn: e.itemsIn,
              itemsOut: e.itemsOut,
              durationMs: e.durationMs,
              pinned: e.pinned,
              dataTruncated: e.dataTruncated,
              error: e.error,
              input: e.data.input,
              output: e.data.output,
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
          status: e.status === 'success' ? 'success' : 'error',
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
          itemsIn: n.itemsIn,
          itemsOut: n.itemsOut,
          ...(n.finishedAt && {
            durationMs: new Date(n.finishedAt).getTime() - new Date(n.startedAt).getTime(),
          }),
          pinned: n.pinned,
          dataTruncated: n.dataTruncated,
          error: n.error,
          ...(n.input && { input: n.input }),
          ...(n.output && { output: n.output }),
        };
      }
      const status =
        detail.status === 'running'
          ? run.status
          : detail.status === 'success'
            ? 'success'
            : 'error';
      set({ run: { ...run, nodes, status, error: detail.error?.message ?? run.error } });
    },

    runFailed: (message) => {
      set({ run: { ...get().run, status: 'error', error: message } });
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
