import type { NodeDescription } from '@olly/nodes';
import {
  resolveNodePorts,
  type ExpressionPreviewResponse,
  type Item,
  type WorkflowNode,
} from '@olly/shared-types';
import { Pin, PinOff, Play, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApi } from '@/api/api-provider';
import { Button } from '@/components/ui/button';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Select } from '@/components/ui/select';
import { inferSchema, type SchemaField } from '../expression-utils';
import { NodeIcon } from '../node-icon';
import { ParameterPanel } from '../parameter-panel';
import { useEditorStore } from '../store';
import { DataPanel, type DragSource } from './data-views';
import { ExpressionContext, type ExpressionHelpers } from './expression-context';
import { McpCallsPanel } from './mcp-calls';

/** Saída do `console` do nó de código (spec 005, FR-012). */
function ConsoleOutput({ lines }: { lines: string[] | undefined }) {
  if (!lines || lines.length === 0) return null;
  return (
    <section
      aria-label="Console"
      data-testid="ndv-console"
      className="max-h-48 shrink-0 overflow-y-auto border-t"
    >
      <h4 className="sticky top-0 bg-background px-3 py-1.5 text-xs font-semibold">
        Console ({lines.length})
      </h4>
      <pre className="px-3 pb-2 font-mono text-xs whitespace-pre-wrap">{lines.join('\n')}</pre>
    </section>
  );
}

/** Ancestores do nó (para escolher a origem dos dados e sugerir `$('Nó')`). */
function ancestorsOf(nodeId: string, edges: { from: string; to: string }[]): string[] {
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const e of edges) {
      if (e.to === id && !seen.has(e.from)) {
        seen.add(e.from);
        stack.push(e.from);
      }
    }
  }
  return [...seen];
}

function PinEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Item[];
  onSave: (items: Item[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(
    JSON.stringify(
      initial.map((i) => i.json),
      null,
      2,
    ),
  );
  const [error, setError] = useState<string>();
  const save = () => {
    try {
      const parsed: unknown = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (!list.every((v) => v && typeof v === 'object' && !Array.isArray(v)))
        throw new Error('Cada item precisa ser um objeto');
      onSave(list.map((json: Record<string, unknown>) => ({ json })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'JSON inválido');
    }
  };
  return (
    <div className="grid gap-2 p-3">
      <textarea
        aria-label="Dados fixados (JSON)"
        data-testid="pin-editor"
        className="min-h-64 rounded-md border bg-background p-2 font-mono text-xs"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button size="sm" onClick={save}>
          Salvar dados fixados
        </Button>
      </div>
    </div>
  );
}

/**
 * Painel do nó em três colunas, como o NDV do N8N (FR-017, plan §8): Entrada | Parâmetros |
 * Saída, com dados da última execução de teste, pin data e "Executar este nó" (FR-020).
 */
export function NodeDetailsView({
  node,
  description,
  workflowId,
  readOnly,
  projectId,
  published,
  canExecute,
  onRunToNode,
  onClose,
}: {
  node: WorkflowNode;
  description: NodeDescription | undefined;
  workflowId: string;
  readOnly: boolean;
  projectId: string;
  published: boolean;
  canExecute: boolean;
  onRunToNode: (nodeId: string) => void;
  onClose: () => void;
}) {
  const api = useApi();
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const run = useEditorStore((s) => s.run);
  const pinned = useEditorStore((s) => s.pinData[node.id]);
  const [source, setSource] = useState<string>('input');
  const [editingPin, setEditingPin] = useState(false);

  const ancestors = useMemo(
    () =>
      ancestorsOf(node.id, edges)
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n): n is WorkflowNode => n !== undefined),
    [node.id, edges, nodes],
  );
  // Spec 007, FR-010: nó em laço tem várias execuções; o painel mostra a escolhida.
  const runs = run.runs[node.id] ?? [];
  const [runChoice, setRunChoice] = useState<number | null>(null);
  const selectedRun = runChoice !== null && runs[runChoice] ? runs[runChoice] : run.nodes[node.id];
  const runOf = (id: string) => (id === node.id ? selectedRun : run.nodes[id]);
  const ports = description ? resolveNodePorts(description, node) : { inputs: [], outputs: [] };

  // Entrada: a registrada na execução ou, se o nó não rodou, o que os pais produziram.
  const inputData = useMemo((): Record<string, Item[]> | undefined => {
    const recorded = selectedRun?.input;
    if (recorded && Object.keys(recorded).length > 0) return recorded;
    const fromParents: Item[] = [];
    let any = false;
    for (const e of edges.filter((x) => x.to === node.id)) {
      const out = run.nodes[e.from]?.output?.[e.fromPort];
      if (out) {
        any = true;
        fromParents.push(...out);
      }
    }
    return any ? { main: fromParents } : undefined;
  }, [run, edges, node.id, selectedRun]);

  const sourceNode = ancestors.find((a) => a.id === source);
  const leftData = sourceNode ? runOf(sourceNode.id)?.output : inputData;
  const dragSource: DragSource = sourceNode
    ? { kind: 'node', name: sourceNode.name }
    : { kind: 'input' };

  const firstPort = ports.outputs[0]?.name ?? 'main';
  const outputData = pinned ? { [firstPort]: pinned } : runOf(node.id)?.output;
  const portLabels = Object.fromEntries(
    ports.outputs.map((p) => [p.name, p.displayName ?? p.name]),
  );

  // Os dados de cada nó podem vir de execuções diferentes (FR-020): usa a do nó ou de um pai.
  const previewExecutionId =
    run.nodes[node.id]?.executionId ??
    edges
      .map((e) => (e.to === node.id ? run.nodes[e.from]?.executionId : undefined))
      .find(Boolean) ??
    run.executionId;

  const helpers = useMemo((): ExpressionHelpers => {
    const schemaOf = (items: Item[] | undefined): SchemaField[] => inferSchema(items ?? []);
    const nodeSchemas = Object.fromEntries(
      ancestors.map((a) => {
        const out = run.nodes[a.id]?.output;
        const first = out ? Object.values(out).find((items) => items.length > 0) : undefined;
        return [a.name, schemaOf(first)];
      }),
    );
    return {
      suggestions: { input: schemaOf(inputData?.main), nodes: nodeSchemas },
      preview: (expression) =>
        api.post<ExpressionPreviewResponse>(`/api/v1/workflows/${workflowId}/expressions/preview`, {
          definition: useEditorStore.getState().definition(),
          nodeId: node.id,
          expression,
          ...(previewExecutionId && { executionId: previewExecutionId }),
        }),
    };
  }, [ancestors, inputData, run, api, workflowId, node.id, previewExecutionId]);

  const store = useEditorStore.getState;

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-testid="ndv"
          // O canvas devolve o foco ao nó logo após abrir; perder o foco não fecha o painel
          // (Esc, o botão Fechar e o clique fora continuam fechando).
          onFocusOutside={(e) => {
            e.preventDefault();
          }}
          // Esc no editor de código fecha as sugestões do Monaco, não o painel (spec 005).
          onEscapeKeyDown={(e) => {
            if (e.target instanceof Element && e.target.closest('.monaco-editor'))
              e.preventDefault();
          }}
          className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
        >
          <header className="flex items-center gap-2 border-b px-4 py-2">
            <NodeIcon name={description?.icon} className="size-4" />
            <DialogPrimitive.Title className="flex-1 truncate font-semibold">
              {node.name}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {description?.displayName}
              </span>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Fechar painel do nó"
              >
                <X />
              </Button>
            </DialogPrimitive.Close>
          </header>
          <div className="grid min-h-0 flex-1 grid-cols-1 divide-y overflow-auto lg:grid-cols-[1fr_minmax(22rem,1.1fr)_1fr] lg:divide-x lg:divide-y-0 lg:overflow-hidden">
            <DataPanel
              title="Entrada"
              testId="ndv-input"
              data={leftData}
              source={dragSource}
              truncated={
                sourceNode ? runOf(sourceNode.id)?.dataTruncated : runOf(node.id)?.dataTruncated
              }
              empty={
                ports.inputs.length === 0
                  ? 'Gatilho: não recebe entrada.'
                  : 'Execute o workflow (ou os nós anteriores) para ver os dados de entrada.'
              }
              header={
                ancestors.length > 0 && (
                  <Select
                    aria-label="Origem dos dados de entrada"
                    className="h-8 text-xs"
                    value={source}
                    onChange={(e) => {
                      setSource(e.target.value);
                    }}
                  >
                    <option value="input">Entrada deste nó ($json)</option>
                    {ancestors.map((a) => (
                      <option key={a.id} value={a.id}>
                        Saída de “{a.name}” ($(&apos;{a.name}&apos;))
                      </option>
                    ))}
                  </Select>
                )
              }
            />
            <div className="min-h-0 overflow-y-auto">
              <ExpressionContext.Provider value={helpers}>
                <ParameterPanel
                  node={node}
                  description={description}
                  readOnly={readOnly}
                  projectId={projectId}
                  workflowId={workflowId}
                  canExecute={canExecute}
                  published={published}
                />
              </ExpressionContext.Provider>
            </div>
            {editingPin ? (
              <PinEditor
                initial={pinned ?? outputData?.[firstPort] ?? []}
                onCancel={() => {
                  setEditingPin(false);
                }}
                onSave={(items) => {
                  store().setPinData(node.id, items);
                  setEditingPin(false);
                }}
              />
            ) : (
              <div className="flex min-h-0 flex-col">
                {runs.length > 1 && (
                  <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
                    <span className="text-muted-foreground">Iteração do laço</span>
                    <Select
                      aria-label="Iteração do laço"
                      data-testid="ndv-run-select"
                      className="h-7 w-auto text-xs"
                      value={String(selectedRun?.runIndex ?? runs.length - 1)}
                      onChange={(e) => {
                        setRunChoice(Number(e.target.value));
                      }}
                    >
                      {runs.map((_, i) => (
                        <option key={i} value={i}>
                          Execução {i + 1} de {runs.length}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <DataPanel
                  title={pinned ? 'Saída (dados fixados)' : 'Saída'}
                  testId="ndv-output"
                  data={outputData}
                  portLabels={portLabels}
                  truncated={!pinned && runOf(node.id)?.dataTruncated}
                  empty={
                    runOf(node.id)?.error ? (
                      <span className="text-destructive">{runOf(node.id)?.error?.message}</span>
                    ) : runOf(node.id)?.dataRedacted ? (
                      'Sem a permissão execution:readData: os dados desta execução não são exibidos.'
                    ) : (
                      'Execute para ver a saída deste nó.'
                    )
                  }
                  toolbar={
                    <div className="flex gap-1">
                      {canExecute && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={run.status === 'running'}
                          onClick={() => {
                            onRunToNode(node.id);
                          }}
                        >
                          <Play /> Executar este nó
                        </Button>
                      )}
                      {!readOnly && pinned && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingPin(true);
                            }}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              store().setPinData(node.id, null);
                            }}
                          >
                            <PinOff /> Desafixar
                          </Button>
                        </>
                      )}
                      {!readOnly && !pinned && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Fixar estes dados: as próximas execuções usam-nos sem executar o nó"
                          onClick={() => {
                            const items = outputData?.[firstPort];
                            if (items) store().setPinData(node.id, items);
                            else setEditingPin(true);
                          }}
                        >
                          <Pin /> Fixar dados
                        </Button>
                      )}
                    </div>
                  }
                />
                <ConsoleOutput lines={runOf(node.id)?.console} />
                {node.type === 'ai.mcpClient' && (
                  <McpCallsPanel
                    executionId={runOf(node.id)?.executionId ?? run.executionId ?? undefined}
                    nodeId={node.id}
                    runIndex={runOf(node.id)?.runIndex}
                    status={runOf(node.id)?.status}
                  />
                )}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
