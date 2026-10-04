import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { NodeDescription } from '@olly/nodes';
import type { WorkflowDetail } from '@olly/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, Loader2, Play, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useBlocker, useParams } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '@/api/client';
import { useApi } from '@/api/api-provider';
import { queryKeys, useNodeTypes, useWorkflow } from '@/api/queries';
import { useCan } from '@/api/use-can';
import { useTheme } from '@/components/theme/theme-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { IssuesPanel } from './issues-panel';
import { NODE_DRAG_MIME, NodePalette } from './node-palette';
import { NodeDetailsView } from './ndv/node-details-view';
import { useEditorStore } from './store';
import { NodeActionsContext, type NodeActions } from './node-actions';
import { useTestRun } from './use-test-run';
import { WorkflowEdgeView, type OllyFlowEdge } from './workflow-edge';
import { WorkflowNodeView, type OllyFlowNode } from './workflow-node';

const nodeTypes = { olly: WorkflowNodeView };
const edgeTypes = { olly: WorkflowEdgeView };
const NEW_NODE_GAP = 260;

/** Editor visual de workflow (spec 002, FR-007/FR-008/FR-015). */
export function EditorPage() {
  const { id = '' } = useParams();
  const workflow = useWorkflow(id);
  const nodeTypesQuery = useNodeTypes();
  const loadedId = useEditorStore((s) => s.workflowId);

  useEffect(() => {
    if (workflow.data && loadedId !== workflow.data.id)
      useEditorStore.getState().load(workflow.data);
  }, [workflow.data, loadedId]);
  // Ao sair do editor, descarta o estado: reabrir parte da versão salva.
  useEffect(
    () => () => {
      useEditorStore.getState().reset();
    },
    [id],
  );

  if (workflow.isError) {
    return <p className="p-6 text-muted-foreground">Workflow não encontrado ou sem acesso.</p>;
  }
  if (!workflow.data || !nodeTypesQuery.data || loadedId !== workflow.data.id) {
    return (
      <p className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando workflow…
      </p>
    );
  }
  return (
    <ReactFlowProvider>
      <Editor workflow={workflow.data} types={nodeTypesQuery.data} />
    </ReactFlowProvider>
  );
}

function Editor({ workflow, types }: { workflow: WorkflowDetail; types: NodeDescription[] }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const flow = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const readOnly = !useCan('workflow:update', workflow.projectId);
  const canExecute = useCan('workflow:execute', workflow.projectId);
  const runTest = useTestRun(workflow.id);
  const [ndvNodeId, setNdvNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const state = useEditorStore();
  const { nodes, edges, selection, errors, warnings, dirty, name, run, pinData } = state;
  const typesByName = useMemo(() => new Map(types.map((t) => [t.type, t])), [types]);
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  const errorsByNode = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of errors)
      for (const nodeId of issue.nodeIds)
        map.set(nodeId, [...(map.get(nodeId) ?? []), issue.message]);
    return map;
  }, [errors]);

  const flowNodes = useMemo<OllyFlowNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: 'olly',
        position: { x: node.position[0], y: node.position[1] },
        data: {
          node,
          description: typesByName.get(node.type),
          errors: errorsByNode.get(node.id) ?? [],
          run: run.nodes[node.id],
          pinned: node.id in pinData,
        },
        selected: selection.nodeIds.includes(node.id),
        ...(measured[node.id] && { measured: measured[node.id] }),
      })),
    [nodes, typesByName, errorsByNode, selection.nodeIds, measured, run.nodes, pinData],
  );
  const flowEdges = useMemo<OllyFlowEdge[]>(
    () =>
      edges.map((e) => ({
        id: e.id,
        type: 'olly',
        source: e.from,
        sourceHandle: e.fromPort,
        target: e.to,
        targetHandle: e.toPort,
        selected: selection.edgeIds.includes(e.id),
        data: { hovered: hoveredEdgeId === e.id, readOnly, onHover: setHoveredEdgeId },
      })),
    [edges, selection.edgeIds, hoveredEdgeId, readOnly],
  );

  const onNodesChange = useCallback((changes: NodeChange<OllyFlowNode>[]) => {
    const store = useEditorStore.getState();
    const positions: Record<string, [number, number]> = {};
    const selected = new Set(store.selection.nodeIds);
    let selectionChanged = false;
    const sizes: Record<string, { width: number; height: number }> = {};
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        positions[change.id] = [Math.round(change.position.x), Math.round(change.position.y)];
      } else if (change.type === 'dimensions' && change.dimensions) {
        sizes[change.id] = change.dimensions;
      } else if (change.type === 'select') {
        selectionChanged = true;
        if (change.selected) selected.add(change.id);
        else selected.delete(change.id);
      }
    }
    if (Object.keys(positions).length > 0) store.moveNodes(positions);
    if (Object.keys(sizes).length > 0) setMeasured((m) => ({ ...m, ...sizes }));
    if (selectionChanged)
      store.setSelection({ nodeIds: [...selected], edgeIds: store.selection.edgeIds });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<OllyFlowEdge>[]) => {
    const store = useEditorStore.getState();
    const selected = new Set(store.selection.edgeIds);
    let changed = false;
    for (const change of changes) {
      if (change.type !== 'select') continue;
      changed = true;
      if (change.selected) selected.add(change.id);
      else selected.delete(change.id);
    }
    if (changed) store.setSelection({ nodeIds: store.selection.nodeIds, edgeIds: [...selected] });
  }, []);

  const onConnect = useCallback((c: Connection) => {
    if (!c.sourceHandle || !c.targetHandle) return;
    useEditorStore
      .getState()
      .connect({ from: c.source, fromPort: c.sourceHandle, to: c.target, toPort: c.targetHandle });
  }, []);

  /** Garante que o nó na posição esteja visível; senão, centraliza a vista nele. */
  const ensureVisible = useCallback(
    (position: [number, number]) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const start = flow.flowToScreenPosition({ x: position[0], y: position[1] });
      const end = flow.flowToScreenPosition({ x: position[0] + 200, y: position[1] + 60 });
      if (start.x < rect.left || start.y < rect.top || end.x > rect.right || end.y > rect.bottom) {
        void flow.setCenter(position[0] + 100, position[1] + 30, { zoom: flow.getZoom() });
      }
    },
    [flow],
  );

  const addNode = useCallback(
    (type: NodeDescription, at?: [number, number]) => {
      const store = useEditorStore.getState();
      let position = at;
      if (!position) {
        const anchor = store.nodes.find((n) => n.id === store.selection.nodeIds.at(-1));
        if (anchor) {
          position = [anchor.position[0] + NEW_NODE_GAP, anchor.position[1]];
        } else {
          const rect = canvasRef.current?.getBoundingClientRect();
          const center = rect
            ? flow.screenToFlowPosition({
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
              })
            : { x: 0, y: 0 };
          position = [Math.round(center.x - 90), Math.round(center.y - 28)];
        }
      }
      store.addNode(type, position);
      ensureVisible(position);
    },
    [flow, ensureVisible],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      const type = typesByName.get(e.dataTransfer.getData(NODE_DRAG_MIME));
      if (!type || readOnly) return;
      e.preventDefault();
      const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(type, [Math.round(p.x), Math.round(p.y)]);
    },
    [flow, typesByName, addNode, readOnly],
  );

  const save = useCallback(async () => {
    const s = useEditorStore.getState();
    if (readOnly || saving || !s.workflowId) return;
    setSaving(true);
    try {
      const saved = await api.put<WorkflowDetail>(`/api/v1/workflows/${s.workflowId}`, {
        name: s.name,
        definition: s.definition(),
        baseVersion: s.baseVersion,
      });
      s.markSaved(saved);
      queryClient.setQueryData(queryKeys.workflow(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflows(saved.projectId) });
      toast.success('Workflow salvo');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
      } else if (error instanceof ApiError && error.status === 422) {
        s.setIssues(
          error.issues.map((i) => ({
            code: i.code ?? 'invalid',
            message: i.message,
            nodeIds: i.nodeIds ?? [],
          })),
        );
        toast.error('O workflow tem erros', {
          description: 'Corrija os nós destacados e salve de novo.',
        });
      } else {
        toast.error('Não foi possível salvar', {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    } finally {
      setSaving(false);
    }
  }, [api, queryClient, readOnly, saving]);

  const reloadLatest = useCallback(async () => {
    const latest = await api.get<WorkflowDetail>(`/api/v1/workflows/${workflow.id}`);
    queryClient.setQueryData(queryKeys.workflow(latest.id), latest);
    useEditorStore.getState().load(latest);
    setConflict(false);
    toast.info('Versão mais recente carregada');
  }, [api, queryClient, workflow.id]);

  // Atalhos (FR-008). Dentro de campos de texto só o Ctrl+S vale.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        void save();
        return;
      }
      const target = e.target as HTMLElement | null;
      // Com o painel do nó aberto, as teclas pertencem ao painel.
      if (document.querySelector('[data-testid="ndv"]')) return;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const store = useEditorStore.getState();
      if (e.key === 'Enter' && store.selection.nodeIds.length === 1) {
        setNdvNodeId(store.selection.nodeIds[0] ?? null);
        return;
      }
      if (readOnly) return;
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        store.redo();
      } else if (mod && key === 'c') {
        store.copy();
      } else if (mod && key === 'v') {
        e.preventDefault();
        store.paste();
        const pasted = useEditorStore
          .getState()
          .nodes.find((n) => n.id === useEditorStore.getState().selection.nodeIds[0]);
        if (pasted) ensureVisible(pasted.position);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store.removeSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [save, readOnly, ensureVisible]);

  // Alterações não salvas: confirma antes de sair (FR-008).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Há alterações não salvas. Sair mesmo assim?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  const ndvNode = ndvNodeId ? nodes.find((n) => n.id === ndvNodeId) : undefined;
  const running = run.status === 'running';
  const nodeActions = useMemo<NodeActions>(
    () => ({
      canExecute,
      running,
      runNode: (nodeId) => void runTest(nodeId),
    }),
    [canExecute, running, runTest],
  );

  return (
    <div className="-m-6 flex h-[calc(100svh-3.5rem)] flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Voltar para a lista"
        >
          <Link to={`/workflows?project=${workflow.projectId}`}>
            <ArrowLeft />
          </Link>
        </Button>
        <Input
          aria-label="Nome do workflow"
          className="h-8 max-w-sm font-medium"
          value={name}
          disabled={readOnly}
          onChange={(e) => {
            state.setName(e.target.value);
          }}
        />
        {dirty && (
          <span data-testid="dirty-indicator" className="text-xs text-muted-foreground">
            ● Alterações não salvas
          </span>
        )}
        <div className="flex-1" />
        {canExecute && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runTest()}
            disabled={running || nodes.length === 0}
            title="Executar o workflow em modo de teste (não precisa salvar)"
          >
            {running ? <Loader2 className="animate-spin" /> : <Play />}
            {running ? 'Executando…' : 'Executar workflow'}
          </Button>
        )}
        {readOnly ? (
          <Badge variant="secondary" data-testid="readonly-badge">
            <Eye className="size-3" /> Somente leitura
          </Badge>
        ) : (
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={saving || !name.trim()}
            title="Salvar (Ctrl+S)"
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Salvar
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        {!readOnly && (
          <NodePalette
            types={types}
            onAdd={(t) => {
              addNode(t);
            }}
          />
        )}
        <div
          ref={canvasRef}
          className="relative min-w-0 flex-1"
          data-testid="canvas"
          onDragOver={(e) => {
            if (!readOnly) e.preventDefault();
          }}
          onDrop={onDrop}
        >
          <NodeActionsContext.Provider value={nodeActions}>
            <ReactFlow<OllyFlowNode, OllyFlowEdge>
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onEdgeMouseEnter={(_e, edge) => {
                setHoveredEdgeId(edge.id);
              }}
              onEdgeMouseLeave={() => {
                setHoveredEdgeId(null);
              }}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDragStart={() => {
                state.checkpoint();
              }}
              onNodeDoubleClick={(_e, n) => {
                setNdvNodeId(n.id);
              }}
              isValidConnection={(c) => c.source !== c.target}
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              deleteKeyCode={null}
              // Clique duplo abre o painel do nó (como no N8N), não dá zoom.
              zoomOnDoubleClick={false}
              colorMode={theme}
              fitView
              fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </NodeActionsContext.Provider>
          {nodes.length === 0 && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              {readOnly ? 'Workflow vazio.' : 'Adicione um nó pela paleta à esquerda.'}
            </p>
          )}
          <IssuesPanel
            errors={errors}
            warnings={warnings}
            nodes={nodes}
            onSelect={(nodeIds) => {
              state.setSelection({ nodeIds, edgeIds: [] });
            }}
          />
        </div>
      </div>
      {ndvNode && (
        <NodeDetailsView
          key={ndvNode.id}
          node={ndvNode}
          description={typesByName.get(ndvNode.type)}
          workflowId={workflow.id}
          readOnly={readOnly}
          projectId={workflow.projectId}
          canExecute={canExecute}
          onRunToNode={(nodeId) => void runTest(nodeId)}
          onClose={() => {
            setNdvNodeId(null);
          }}
        />
      )}

      <Dialog open={conflict} onOpenChange={setConflict}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Workflow alterado por outra pessoa</DialogTitle>
            <DialogDescription>
              Uma versão mais recente foi salva desde que você abriu este workflow. Recarregue para
              ver a versão atual; suas alterações não salvas serão descartadas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConflict(false);
              }}
            >
              Cancelar
            </Button>
            <Button onClick={() => void reloadLatest()}>Recarregar versão mais recente</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
