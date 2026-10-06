import type {
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowDiff,
  WorkflowVersionDetail,
} from '@olly/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { GitCompare, History, Loader2, RotateCcw, Save, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { queryKeys, useVersions } from '@/api/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { describePatch } from './version-diff';

export interface DiffView {
  diff: WorkflowDiff;
  from: WorkflowDefinition;
  to: WorkflowDefinition;
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Histórico do workflow (spec 009, FR-008 a FR-010): versões com autor, data e mensagem;
 * comparação visual no canvas com a versão atual; restauração como nova versão; e salvar com
 * mensagem (opcional).
 */
export function VersionHistoryPanel({
  workflow,
  canUpdate,
  dirty,
  view,
  onView,
  onSave,
  onRestored,
  onClose,
}: {
  workflow: WorkflowDetail;
  canUpdate: boolean;
  dirty: boolean;
  view: DiffView | null;
  onView: (view: DiffView | null) => void;
  onSave: (message: string) => Promise<void>;
  onRestored: (restored: WorkflowDetail) => void;
  onClose: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const versions = useVersions(workflow.id);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<number | 'save' | null>(null);

  const compare = async (version: number) => {
    setBusy(version);
    try {
      const [diff, from, to] = await Promise.all([
        api.get<WorkflowDiff>(
          `/api/v1/workflows/${workflow.id}/diff?from=${version}&to=${workflow.version}`,
        ),
        api.get<WorkflowVersionDetail>(`/api/v1/workflows/${workflow.id}/versions/${version}`),
        api.get<WorkflowVersionDetail>(
          `/api/v1/workflows/${workflow.id}/versions/${workflow.version}`,
        ),
      ]);
      onView({ diff, from: from.definition, to: to.definition });
    } catch (error) {
      toast.error('Não foi possível comparar', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (version: number) => {
    setBusy(version);
    try {
      const restored = await api.post<WorkflowDetail>(
        `/api/v1/workflows/${workflow.id}/versions/${version}/restore`,
        {},
      );
      onView(null);
      onRestored(restored);
      void queryClient.invalidateQueries({ queryKey: queryKeys.versions(workflow.id) });
      toast.success(`Versão ${version} restaurada como versão ${restored.version}`);
    } catch (error) {
      toast.error('Não foi possível restaurar', {
        description:
          error instanceof ApiError
            ? [error.message, ...error.issues.map((i) => i.message)].join(' — ')
            : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    try {
      await onSave(message.trim());
      setMessage('');
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-l bg-card"
      data-testid="version-history"
      aria-label="Histórico de versões"
    >
      <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
        <span className="flex items-center gap-2">
          <History className="size-4" /> Histórico
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Fechar histórico"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {canUpdate && (
        <form onSubmit={(e) => void save(e)} className="grid gap-2 border-b p-3">
          <Input
            aria-label="Mensagem da versão"
            placeholder="Mensagem da versão (opcional)"
            maxLength={500}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
            }}
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={busy !== null || view !== null}
          >
            {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />} Salvar versão
          </Button>
        </form>
      )}
      {view ? (
        <DiffSummary
          view={view}
          onExit={() => {
            onView(null);
          }}
        />
      ) : (
        <ol className="min-h-0 flex-1 overflow-auto">
          {(versions.data ?? []).map((v) => {
            const current = v.version === workflow.version;
            return (
              <li
                key={v.version}
                className="grid gap-1 border-b px-3 py-2 text-sm"
                data-testid={`version-${v.version}`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">v{v.version}</span>
                  {current && <Badge variant="secondary">atual</Badge>}
                  {workflow.publishedVersion === v.version && <Badge>publicada</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {dateFormat.format(new Date(v.createdAt))}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {v.createdByName ?? 'Usuário removido'}
                </span>
                {v.message && <p className="text-xs">{v.message}</p>}
                {!current && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      disabled={busy !== null}
                      onClick={() => void compare(v.version)}
                    >
                      <GitCompare /> Comparar com a atual
                    </Button>
                    {canUpdate && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        disabled={busy !== null || dirty}
                        title={
                          dirty ? 'Salve ou descarte as alterações antes de restaurar' : undefined
                        }
                        onClick={() => void restore(v.version)}
                      >
                        <RotateCcw /> Restaurar
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

function DiffSummary({ view, onExit }: { view: DiffView; onExit: () => void }) {
  const { diff, from } = view;
  const before = new Map(from.nodes.map((n) => [n.id, n]));
  const empty =
    diff.nodes.added.length +
      diff.nodes.removed.length +
      diff.nodes.changed.length +
      diff.edges.added.length +
      diff.edges.removed.length +
      diff.settings.length ===
    0;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 text-sm" data-testid="diff-summary">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">
          v{diff.from} → v{diff.to}
        </span>
        <Button size="sm" variant="outline" className="h-7" onClick={onExit}>
          Sair da comparação
        </Button>
      </div>
      <p className="mb-3 flex flex-wrap gap-2 text-xs">
        <Legend className="bg-emerald-500" label="adicionado" />
        <Legend className="bg-destructive" label="removido" />
        <Legend className="bg-amber-500" label="alterado" />
      </p>
      {empty && <p className="text-muted-foreground">Nenhuma diferença.</p>}
      {diff.nodes.added.map((n) => (
        <p key={`a-${n.id}`} className="text-emerald-700 dark:text-emerald-400">
          + {n.name}
        </p>
      ))}
      {diff.nodes.removed.map((n) => (
        <p key={`r-${n.id}`} className="text-destructive">
          − {n.name}
        </p>
      ))}
      {diff.nodes.changed.map((c) => {
        const old = before.get(c.id);
        return (
          <div key={`c-${c.id}`} className="mt-2" data-testid={`diff-node-${c.name}`}>
            <p className="font-medium text-amber-700 dark:text-amber-400">
              ~ {c.name}
              {c.previousName && <span className="font-normal"> (era “{c.previousName}”)</span>}
            </p>
            <ul className="ml-3 list-disc font-mono text-[11px] break-all">
              {c.params.map((op, i) => (
                <li key={`p${i}`}>{describePatch(op, old?.params)}</li>
              ))}
              {c.settings.map((op, i) => (
                <li key={`s${i}`}>configuração · {describePatch(op, old?.settings)}</li>
              ))}
              {c.other.map((op, i) => (
                <li key={`o${i}`}>
                  {describePatch(op, {
                    credentialId: old?.credentialId,
                    disabled: old?.disabled ?? false,
                  })}
                </li>
              ))}
              {c.type && (
                <li>
                  tipo: {c.type.from} → {c.type.to}
                </li>
              )}
              {c.position && <li>posição alterada</li>}
            </ul>
          </div>
        );
      })}
      {(diff.edges.added.length > 0 || diff.edges.removed.length > 0) && (
        <p className="mt-2 text-xs text-muted-foreground">
          Conexões: {diff.edges.added.length} adicionada(s), {diff.edges.removed.length} removida(s)
        </p>
      )}
      {diff.settings.length > 0 && (
        <ul className="mt-2 ml-3 list-disc font-mono text-[11px]">
          {diff.settings.map((op, i) => (
            <li key={i}>workflow · {describePatch(op, from.settings)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('inline-block size-2.5 rounded-full', className)} /> {label}
    </span>
  );
}
