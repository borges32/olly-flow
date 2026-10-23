import type { ExecutionList, ExecutionSummary } from '@olly/shared-types';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/api/api-provider';
import { Button } from '@/components/ui/button';
import { EXECUTION_STATUS_LABEL } from '@/executions/execution-log';
import { ExecutionLogDialog } from '@/executions/execution-log-dialog';

/** Consulta das execuções ativas do workflow, só com a aba visível (plan §6). */
const POLL_MS = 10_000;
const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' });
const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Manual',
  webhook: 'Webhook',
  subworkflow: 'Sub-workflow',
  chat: 'Chat',
  error: 'Gatilho de erro',
};

/**
 * Spec 029, FR-015 (HU-2): "N em andamento" na barra do editor, só com N > 0. Abre a lista
 * curta das execuções do workflow na fila, em andamento ou aguardando; escolher uma abre o
 * acompanhamento ao vivo dela.
 */
export function RunningExecutions({ workflowId }: { workflowId: string }) {
  const api = useApi();
  const { data } = useQuery({
    queryKey: ['executions', { workflowId, status: 'active' }],
    queryFn: () =>
      api.get<ExecutionList>(
        `/api/v1/executions?${new URLSearchParams({
          workflowId,
          status: 'queued,running,waiting',
          limit: '20',
        }).toString()}`,
      ),
    refetchInterval: POLL_MS,
  });
  const [open, setOpen] = useState(false);
  const [watching, setWatching] = useState<ExecutionSummary | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const items = data?.items ?? [];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      {items.length > 0 && (
        <div ref={box} className="relative">
          <Button
            size="sm"
            variant="outline"
            aria-haspopup="menu"
            aria-expanded={open}
            data-testid="running-executions"
            title="Execuções deste workflow na fila, em andamento ou aguardando"
            onClick={() => {
              setOpen((v) => !v);
            }}
          >
            <Loader2 className="animate-spin" />
            {items.length >= 20 ? '20+' : String(items.length)} em andamento
          </Button>
          {open && (
            <div
              role="menu"
              aria-label="Execuções em andamento"
              className="absolute right-0 z-40 mt-1 grid max-h-80 min-w-64 overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
            >
              {items.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  role="menuitem"
                  className="grid gap-0.5 rounded px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => {
                    setOpen(false);
                    setWatching(e);
                  }}
                >
                  <span className="font-medium">
                    {EXECUTION_STATUS_LABEL[e.status]} · início {time.format(new Date(e.startedAt))}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.mode === 'test' ? 'Teste' : 'Produção'} ·{' '}
                    {TRIGGER_LABEL[e.triggerType] ?? e.triggerType}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {watching && (
        <ExecutionLogDialog
          executionId={watching.id}
          workflowName={watching.workflowName}
          live
          onClose={() => {
            setWatching(null);
          }}
        />
      )}
    </>
  );
}
