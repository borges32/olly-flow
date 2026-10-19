import type { ExecutionSummary } from '@olly/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, ScrollText, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { useCan } from '@/api/use-can';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExecutionLogDialog } from './execution-log-dialog';

/**
 * Ações de uma execução terminada (spec 026, FR-001): "Log" e, com `execution:delete` no
 * projeto, "Excluir" (com confirmação, FR-005).
 */
export function ExecutionActions({ execution }: { execution: ExecutionSummary }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const canDelete = useCan('execution:delete', execution.projectId);
  // Posição do menu (fixa, a partir do botão): a tabela corta o que passa da borda.
  const [open, setOpen] = useState<{ top: number; right: number } | null>(null);
  const [dialog, setDialog] = useState<'log' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  // Fecha o menu ao clicar fora, com Esc ou ao rolar.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    // O menu é fixo na tela: ao rolar, ficaria longe do botão.
    const onScroll = () => {
      setOpen(null);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const choose = (action: 'log' | 'delete') => {
    setOpen(null);
    setDialog(action);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/api/v1/executions/${execution.id}`);
      toast.success('Execução excluída');
      setDialog(null);
    } catch (error) {
      // Já excluída em outra aba: some da lista do mesmo jeito.
      if (error instanceof ApiError && error.status === 404) setDialog(null);
      else
        toast.error('Não foi possível excluir a execução', {
          description: error instanceof Error ? error.message : undefined,
        });
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ['executions'] });
    }
  };

  return (
    <div ref={menu} className="inline-block text-left">
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label="Ações da execução"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setOpen((v) =>
            v ? null : { top: rect.bottom + 4, right: window.innerWidth - rect.right },
          );
        }}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {open && (
        <div
          role="menu"
          aria-label="Ações da execução"
          style={open}
          className="fixed z-40 grid min-w-36 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => {
              choose('log');
            }}
          >
            <ScrollText className="size-4" /> Log
          </button>
          {canDelete && (
            <button
              type="button"
              role="menuitem"
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-accent"
              onClick={() => {
                choose('delete');
              }}
            >
              <Trash2 className="size-4" /> Excluir
            </button>
          )}
        </div>
      )}
      {dialog === 'log' && (
        <ExecutionLogDialog
          executionId={execution.id}
          workflowName={execution.workflowName}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      <Dialog
        open={dialog === 'delete'}
        onOpenChange={(v) => {
          if (!v) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir a execução?</DialogTitle>
            <DialogDescription>
              A execução de “{execution.workflowName}” e todos os dados dela (entrada e saída dos
              nós, arquivos, passos de IA) são removidos. Não há como desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialog(null);
              }}
            >
              Cancelar
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              <Trash2 /> Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
