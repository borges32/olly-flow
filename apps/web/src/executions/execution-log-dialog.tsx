import { Copy, ExternalLink, FileJson, FileText, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useExecution } from '@/api/queries';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { downloadFile, downloadJson } from '@/editor/workflow-file-io';
import {
  LOG_STATUS_LABEL,
  filterLog,
  formatDuration,
  logJson,
  logRows,
  logSummary,
  logText,
  shortId,
  type LogStatusFilter,
} from './execution-log';

const STATUS_CLASS: Record<string, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-destructive',
  cancelled: 'text-amber-600 dark:text-amber-400',
  waiting: 'text-sky-600 dark:text-sky-400',
};

/**
 * Log da execução (spec 026, FR-002 a FR-004): uma linha por nó executado, com filtros, cópia,
 * downloads e o link para a subexecução de cada "Executar workflow".
 */
export function ExecutionLogDialog({
  executionId,
  workflowName,
  onClose,
}: {
  executionId: string;
  workflowName: string;
  onClose: () => void;
}) {
  const { data: detail, isLoading, error } = useExecution(executionId);
  const [status, setStatus] = useState<LogStatusFilter>('all');
  const [text, setText] = useState('');
  const log = useMemo(() => (detail ? logRows(detail) : null), [detail]);
  const rows = useMemo(() => (log ? filterLog(log.rows, status, text) : []), [log, status, text]);
  const fileBase = `execucao-${shortId(executionId)}-log`;

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
        <div className="grid gap-1 pr-6">
          <DialogTitle className="truncate">
            Log — execução {shortId(executionId)} · {workflowName}
          </DialogTitle>
          <DialogDescription data-testid="execution-log-summary">
            {detail ? logSummary(detail) : ' '}
          </DialogDescription>
        </div>
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
            disabled={!detail}
            onClick={() => {
              if (!detail) return;
              void navigator.clipboard
                .writeText(logText(detail, workflowName, rows))
                .then(() => toast.success('Log copiado'));
            }}
          >
            <Copy /> Copiar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!detail}
            onClick={() => {
              if (detail)
                downloadFile(logText(detail, workflowName, rows), `${fileBase}.txt`, 'text/plain');
            }}
          >
            <FileText /> .txt
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!detail}
            onClick={() => {
              if (detail) downloadJson(logJson(detail, workflowName, rows), `${fileBase}.json`);
            }}
          >
            <FileJson /> .json
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to={`/executions/${executionId}`}>
              <ExternalLink /> Abrir execução
            </Link>
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          {isLoading && (
            <div className="flex justify-center p-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <p className="p-4 text-sm text-destructive">Não foi possível carregar a execução.</p>
          )}
          {log && rows.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Nenhum evento com esses filtros.</p>
          )}
          {rows.length > 0 && (
            <table className="w-full text-xs" data-testid="execution-log-rows">
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.key}
                    data-testid={`log-row-${r.nodeName}`}
                    className="border-b align-top last:border-b-0"
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
                    <td className={cn('px-3 py-2 whitespace-nowrap', STATUS_CLASS[r.status])}>
                      {r.status}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDuration(r.durationMs)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.itemsIn === null ? '' : `${String(r.itemsIn)} → ${String(r.itemsOut)}`}
                    </td>
                    <td className="px-3 py-2">
                      <div className="grid gap-0.5">
                        {r.subExecutions.map((s) => (
                          <Link
                            key={s.id}
                            to={`/executions/${s.id}`}
                            className="inline-flex items-center gap-1 whitespace-nowrap hover:underline"
                            data-testid="log-sub-execution"
                          >
                            <ExternalLink className="size-3" /> Subexecução {shortId(s.id)}
                          </Link>
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
              <Link
                key={s.id}
                to={`/executions/${s.id}`}
                className="inline-flex items-center gap-1 hover:underline"
              >
                <ExternalLink className="size-3" /> {s.workflowName} · {shortId(s.id)} · {s.status}
              </Link>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
