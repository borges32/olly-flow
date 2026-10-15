import type { NodeDescription } from '@olly/nodes';
import type { WorkflowNode } from '@olly/shared-types';
import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Clock,
  Loader2,
  Pin,
  Recycle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ChatColumn } from './chat-panel';
import { logEntries, defaultLogSelection, formatDuration, type LogEntry } from './logs';
import { NodeIcon } from './node-icon';
import { AgentStepsPanel } from './ndv/agent-steps';
import { DataPanel } from './ndv/data-views';
import { useEditorStore } from './store';

/** Nós com passos registrados (spec 011, Agent; spec 017, Basic LLM Chain). */
const STEP_TITLES: Record<string, string> = {
  'ai.agent': 'Passos do agente',
  'ai.chainLlm': 'Chamadas ao modelo',
};

function StatusIcon({ status }: { status: LogEntry['status'] }) {
  if (status === 'running') return <Loader2 className="size-4 animate-spin text-primary" />;
  if (status === 'success') return <CircleCheck className="size-4 text-emerald-500" />;
  if (status === 'error') return <CircleX className="size-4 text-destructive" />;
  return <Clock className="size-4 text-muted-foreground" />;
}

/** Detalhes do nó escolhido nos logs: erro, entrada, saída e passos de IA (FR-016). */
function LogDetails({ node }: { node: WorkflowNode }) {
  const view = useEditorStore((s) => s.run.nodes[node.id]);
  const executionId = useEditorStore((s) => s.run.executionId);
  if (!view) return null;
  const stepsTitle = STEP_TITLES[node.type];
  return (
    <div
      className="grid min-h-0 flex-1 auto-rows-min gap-0 overflow-y-auto"
      data-testid="logs-details"
    >
      {view.error && (
        <p role="alert" className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {view.error.message}
        </p>
      )}
      {stepsTitle && (
        <div className="border-b">
          <AgentStepsPanel
            title={stepsTitle}
            executionId={view.executionId ?? executionId ?? undefined}
            nodeId={node.id}
            runIndex={view.runIndex}
            status={view.status}
          />
        </div>
      )}
      <div className="grid min-h-64 grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
        <DataPanel
          title="Entrada"
          testId="logs-input"
          data={view.input}
          truncated={view.dataTruncated}
          downloadName={[node.name, 'entrada']}
          empty={view.dataRedacted ? 'Sem permissão para ver os dados.' : 'Sem entrada.'}
        />
        <DataPanel
          title="Saída"
          testId="logs-output"
          data={view.output}
          truncated={view.dataTruncated}
          downloadName={[node.name, 'saida']}
          empty={view.dataRedacted ? 'Sem permissão para ver os dados.' : 'Sem saída.'}
        />
      </div>
    </div>
  );
}

/**
 * Painel inferior do editor (spec 021, FR-002 e FR-016), como o "Logs" do N8N: recolhido numa
 * barra no pé do canvas; aberto, mostra o chat (com o Chat Trigger) e os logs da execução de
 * teste, com os detalhes do nó escolhido.
 */
export function LogsPanel({
  workflowId,
  hasChat,
  canExecute,
  open,
  onOpenChange,
  typesByName,
}: {
  workflowId: string;
  hasChat: boolean;
  canExecute: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  typesByName: Map<string, NodeDescription>;
}) {
  const nodes = useEditorStore((s) => s.nodes);
  const runNodes = useEditorStore((s) => s.run.nodes);
  const runStatus = useEditorStore((s) => s.run.status);
  const names = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n.name])), [nodes]);
  const entries = useMemo(() => logEntries(runNodes, names), [runNodes, names]);
  const [chosen, setChosen] = useState<string>();
  const selectedId =
    chosen && entries.some((e) => e.nodeId === chosen) ? chosen : defaultLogSelection(entries);
  const selected = nodes.find((n) => n.id === selectedId);
  const showChat = hasChat && canExecute;

  return (
    <section
      aria-label="Logs"
      data-testid="logs-panel"
      data-open={open}
      className={cn('flex shrink-0 flex-col border-t bg-card', open ? 'h-80' : 'h-9')}
    >
      <button
        type="button"
        className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-left text-sm font-semibold hover:bg-accent/50"
        aria-expanded={open}
        onClick={() => {
          onOpenChange(!open);
        }}
      >
        <span className="flex-1">
          {showChat ? 'Chat e logs' : 'Logs'}
          {entries.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {entries.length} {entries.length === 1 ? 'nó' : 'nós'}
              {runStatus === 'running' && ' · executando…'}
            </span>
          )}
        </span>
        {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
      </button>
      {/* Recolhido, o chat fica montado (não perde a conversa); os logs só existem abertos. */}
      <div className={cn('min-h-0 flex-1', open ? 'flex' : 'hidden')}>
        {showChat && <ChatColumn workflowId={workflowId} />}
        {open && (
          <div className="flex min-h-0 min-w-0 flex-1">
            {entries.length === 0 ? (
              <p
                className="m-auto max-w-xs text-center text-sm text-muted-foreground"
                data-testid="logs-empty"
              >
                Nada para mostrar ainda. Execute o workflow
                {showChat ? ' ou envie uma mensagem pelo chat' : ''} para ver os logs.
              </p>
            ) : (
              <>
                <ol
                  aria-label="Nós executados"
                  className="w-64 shrink-0 overflow-y-auto border-r py-1"
                  data-testid="logs-list"
                >
                  {entries.map((e) => (
                    <li key={e.nodeId}>
                      <button
                        type="button"
                        data-testid={`log-${e.name}`}
                        aria-current={e.nodeId === selectedId}
                        onClick={() => {
                          setChosen(e.nodeId);
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/50',
                          e.nodeId === selectedId && 'bg-accent',
                        )}
                      >
                        <StatusIcon status={e.status} />
                        <NodeIcon
                          name={
                            typesByName.get(nodes.find((n) => n.id === e.nodeId)?.type ?? '')?.icon
                          }
                          className="size-3.5 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                        {e.reused && (
                          <Recycle
                            className="size-3 text-muted-foreground"
                            aria-label="reaproveitado"
                          />
                        )}
                        {e.pinned && (
                          <Pin className="size-3 text-muted-foreground" aria-label="fixado" />
                        )}
                        <span className="text-muted-foreground tabular-nums">
                          {formatDuration(e.durationMs)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  {selected && (
                    <>
                      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-sm">
                        <NodeIcon name={typesByName.get(selected.type)?.icon} className="size-4" />
                        <span className="truncate font-semibold">{selected.name}</span>
                        <Badge variant="secondary" className="font-normal">
                          {entries.find((e) => e.nodeId === selected.id)?.itemsOut ?? 0} itens
                        </Badge>
                      </div>
                      <LogDetails key={selected.id} node={selected} />
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
