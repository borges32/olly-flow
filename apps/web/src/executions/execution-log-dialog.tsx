import type { ExecutionSteps, NodeExecutionStatus, SubExecutionRef } from '@olly/shared-types';
import { Copy, ExternalLink, FileJson, FileText, Loader2, Square, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useCan } from '@/api/use-can';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { downloadFile, downloadJson } from '@/editor/workflow-file-io';
import { useCancelExecution } from '@/editor/use-test-run';
import {
  EXECUTION_STATUS_LABEL,
  LOG_STATUS_LABEL,
  STEP_STATUS_LABEL,
  filterLog,
  formatDuration,
  formatElapsed,
  isActiveStatus,
  logJson,
  logProgress,
  logRows,
  logSummary,
  logText,
  shortId,
  type LogStatusFilter,
} from './execution-log';
import { useLiveExecution } from './use-live-execution';

const STATUS_CLASS: Record<string, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-destructive',
  cancelled: 'text-amber-600 dark:text-amber-400',
  waiting: 'text-sky-600 dark:text-sky-400',
  running: 'text-primary',
};

const MODE_LABEL = { test: 'teste', production: 'produção' } as const;
const clock = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' });

/** Execução aberta no modal: a de quem abriu ou uma subexecução (um modal por vez, FR-011). */
interface Target {
  id: string;
  workflowName: string;
  live: boolean;
}

/**
 * Log da execução (spec 026, FR-002 a FR-004): uma linha por nó executado, com filtros, cópia,
 * downloads e o link para a subexecução de cada "Executar workflow". Spec 029: com a execução
 * na fila, em andamento ou aguardando, vira o acompanhamento ao vivo (FR-001), só com os
 * metadados dos passos (FR-013).
 */
export function ExecutionLogDialog({
  executionId,
  workflowName,
  live = false,
  onClose,
}: {
  executionId: string;
  workflowName: string;
  /** A execução estava ativa na origem (lista, editor): começa já escutando os eventos. */
  live?: boolean;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<Target>({ id: executionId, workflowName, live });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="execution-log"
        className="flex max-h-[calc(100vh-4rem)] flex-col sm:max-w-4xl"
      >
        <LogContent key={target.id} target={target} onOpen={setTarget} />
      </DialogContent>
    </Dialog>
  );
}

function LogContent({ target, onOpen }: { target: Target; onOpen: (t: Target) => void }) {
  const { data, now, connected, gone, failed } = useLiveExecution(target.id, target.live);
  const [status, setStatus] = useState<LogStatusFilter>('all');
  const [text, setText] = useState('');
  const active = data ? isActiveStatus(data.status) : target.live;
  const log = useMemo(() => (data ? logRows(data, now) : null), [data, now]);
  const rows = useMemo(() => (log ? filterLog(log.rows, status, text) : []), [log, status, text]);
  const fileBase = `execucao-${shortId(target.id)}-log`;
  // Copiar e baixar só no fim: antes, o Log ainda está incompleto (plan §5).
  const complete = data !== undefined && !active;

  // Rola para o fim a cada novo passo, a menos que o usuário tenha subido a lista.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const rowCount = rows.length;
  useEffect(() => {
    const el = scroller.current;
    if (el && active && pinned.current) el.scrollTop = el.scrollHeight;
  }, [rowCount, active]);

  const openSub = (sub: SubExecutionRef) => {
    onOpen({ id: sub.id, workflowName: sub.workflowName, live: isActiveStatus(sub.status) });
  };

  return (
    <>
      <div className="grid gap-1 pr-6">
        <DialogTitle className="truncate">
          Log — execução {shortId(target.id)} · {target.workflowName}
        </DialogTitle>
        <DialogDescription asChild>
          <div data-testid="execution-log-summary">
            {data && active ? <LiveHeader data={data} now={now} /> : data ? logSummary(data) : ' '}
          </div>
        </DialogDescription>
      </div>
      {!connected && active && (
        <p
          role="status"
          data-testid="execution-live-offline"
          className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          <WifiOff className="size-3.5" /> Conexão perdida. Reconectando…
        </p>
      )}
      {data?.error && (
        <p
          data-testid="execution-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-xs text-destructive"
        >
          {data.error.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Status dos eventos"
          className="h-8 w-44 text-xs"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as LogStatusFilter);
          }}
        >
          {Object.entries(LOG_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Filtrar por nó ou mensagem"
          placeholder="Filtrar por nó ou mensagem"
          className="h-8 min-w-48 flex-1 text-xs"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={!complete}
          onClick={() => {
            if (!data) return;
            void navigator.clipboard
              .writeText(logText(data, target.workflowName, rows))
              .then(() => toast.success('Log copiado'));
          }}
        >
          <Copy /> Copiar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!complete}
          onClick={() => {
            if (data)
              downloadFile(
                logText(data, target.workflowName, rows),
                `${fileBase}.txt`,
                'text/plain',
              );
          }}
        >
          <FileText /> .txt
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!complete}
          onClick={() => {
            if (data) downloadJson(logJson(data, target.workflowName, rows), `${fileBase}.json`);
          }}
        >
          <FileJson /> .json
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to={`/executions/${target.id}`}>
            <ExternalLink /> Abrir execução
          </Link>
        </Button>
        {data && <StopAction execution={data} />}
      </div>
      {data && active && logProgress(data).hidden > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="execution-log-limit">
          Mostrando as últimas {data.steps.length} de {logProgress(data).done} linhas.
        </p>
      )}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="min-h-0 flex-1 overflow-auto rounded-md border"
      >
        {!data && !gone && !failed && (
          <div className="flex justify-center p-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {gone && (
          <p className="p-4 text-sm text-muted-foreground" data-testid="execution-log-gone">
            A execução não existe mais.
          </p>
        )}
        {failed && !data && (
          <p className="p-4 text-sm text-destructive">Não foi possível carregar a execução.</p>
        )}
        {data && active && data.status === 'queued' && rows.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">Na fila, aguardando um worker…</p>
        )}
        {log && rows.length === 0 && !(active && data?.status === 'queued') && (
          <p className="p-4 text-sm text-muted-foreground">
            {active && status === 'all' && !text
              ? 'Aguardando o primeiro nó…'
              : 'Nenhum evento com esses filtros.'}
          </p>
        )}
        {rows.length > 0 && (
          <table className="w-full text-xs" data-testid="execution-log-rows">
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  data-testid={`log-row-${r.nodeName}`}
                  data-status={r.status}
                  className={cn(
                    'border-b align-top last:border-b-0',
                    r.status === 'running' && 'bg-primary/5',
                    r.status === 'error' && 'bg-destructive/5',
                  )}
                >
                  <td className="px-3 py-2 font-mono whitespace-nowrap text-muted-foreground">
                    {r.time}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {r.nodeName}
                      {r.runIndex > 0 && (
                        <span className="ml-1 text-muted-foreground">#{r.runIndex + 1}</span>
                      )}
                    </div>
                    {r.nodeType && (
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {r.nodeType}
                      </div>
                    )}
                    {r.error && (
                      <div className="mt-1 text-destructive" data-testid="log-error">
                        {r.error}
                      </div>
                    )}
                  </td>
                  <td
                    className={cn('px-3 py-2 whitespace-nowrap', STATUS_CLASS[r.status])}
                    data-testid="log-status"
                  >
                    {r.status === 'running' && (
                      <Loader2 className="mr-1 inline size-3 animate-spin" />
                    )}
                    {r.kind === 'node'
                      ? STEP_STATUS_LABEL[r.status as NodeExecutionStatus]
                      : EXECUTION_STATUS_LABEL[r.status as ExecutionSteps['status']]}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap" data-testid="log-duration">
                    {formatDuration(r.durationMs)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.itemsIn === null ? '' : `${String(r.itemsIn)} → ${String(r.itemsOut)}`}
                  </td>
                  <td className="px-3 py-2">
                    <div className="grid gap-0.5">
                      {r.subExecutions.map((s) => (
                        <button
                          type="button"
                          key={s.id}
                          onClick={() => {
                            openSub(s);
                          }}
                          className="inline-flex items-center gap-1 whitespace-nowrap hover:underline"
                          data-testid="log-sub-execution"
                        >
                          <ExternalLink className="size-3" /> Subexecução {shortId(s.id)}
                          {isActiveStatus(s.status) && (
                            <span className="text-primary">(ao vivo)</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {log && log.orphans.length > 0 && (
        <div className="grid gap-1 text-xs">
          <span className="font-medium">Subexecuções</span>
          {log.orphans.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => {
                openSub(s);
              }}
              className="inline-flex items-center gap-1 text-left hover:underline"
            >
              <ExternalLink className="size-3" /> {s.workflowName} · {shortId(s.id)} · {s.status}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Cabeçalho ao vivo (FR-002, FR-007, FR-010): status, tempo decorrido e progresso. */
function LiveHeader({ data, now }: { data: ExecutionSteps; now: number }) {
  const progress = logProgress(data);
  return (
    <div className="grid gap-1 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
          data-testid="execution-live"
        >
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          Ao vivo
        </span>
        <span className="font-medium text-foreground" data-testid="execution-live-status">
          {EXECUTION_STATUS_LABEL[data.status]}
          {data.status === 'waiting' &&
            data.resumeAt &&
            ` até ${clock.format(new Date(data.resumeAt))}`}
        </span>
        <span>·</span>
        <span>
          {MODE_LABEL[data.mode]} · {data.triggerType}
          {data.workflowVersion !== null && ` · v${String(data.workflowVersion)}`}
        </span>
        <span>·</span>
        <span>início {clock.format(new Date(data.startedAt))}</span>
        <span>·</span>
        <span data-testid="execution-elapsed">
          {formatElapsed(now - Date.parse(data.startedAt))}
        </span>
      </div>
      <div data-testid="execution-progress">
        {progress.executed} de {progress.nodeCount} nós já rodaram · {progress.done}{' '}
        {progress.done === 1 ? 'passo concluído' : 'passos concluídos'} · {progress.running} em
        andamento
      </div>
    </div>
  );
}

/** HU-3 (FR-014): interromper, com confirmação, para quem pode parar pela lista. */
function StopAction({ execution }: { execution: ExecutionSteps }) {
  const canStop = useCan('workflow:execute', execution.projectId);
  const cancel = useCancelExecution();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!canStop || (execution.status !== 'queued' && execution.status !== 'running')) return null;
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => {
          setConfirming(true);
        }}
      >
        <Square /> Interromper
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Interromper a execução?</DialogTitle>
            <DialogDescription>
              Os nós em andamento são interrompidos e os seguintes não rodam.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void cancel(execution.id).finally(() => {
                  setBusy(false);
                  setConfirming(false);
                });
              }}
            >
              <Square /> Interromper
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
