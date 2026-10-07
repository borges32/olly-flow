import type { ImportFormat, ImportIssue, ImportPreview, WorkflowDetail } from '@olly/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { queryKeys } from '@/api/queries';
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
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

function IssueList({
  title,
  issues,
  tone,
  testId,
}: {
  title: string;
  issues: ImportIssue[];
  tone: 'error' | 'pending' | 'warning';
  testId: string;
}) {
  if (issues.length === 0) return null;
  return (
    <div className="grid gap-1" data-testid={testId}>
      <p className="text-sm font-medium">
        {title} ({issues.length})
      </p>
      <ul
        className={cn(
          'grid list-disc gap-0.5 pl-5 text-xs',
          tone === 'error' && 'text-destructive',
          tone === 'pending' && 'text-amber-700 dark:text-amber-300',
          tone === 'warning' && 'text-muted-foreground',
        )}
      >
        {issues.map((i, k) => (
          <li key={`${i.code}-${String(k)}`}>{i.message}</li>
        ))}
      </ul>
    </div>
  );
}

function MigrationReportView({ preview }: { preview: ImportPreview }) {
  const report = preview.migration;
  if (!report) return null;
  const { converted, withWarnings, unsupported } = report.nodes;
  return (
    <div className="grid gap-2 rounded-md border p-3" data-testid="import-migration">
      <p className="text-sm font-medium">Relatório de migração do N8N</p>
      <p className="text-xs text-muted-foreground">
        {converted.length} convertido(s) · {withWarnings.length} com aviso · {unsupported.length}{' '}
        não suportado(s)
      </p>
      {withWarnings.length > 0 && (
        <ul className="grid list-disc gap-0.5 pl-5 text-xs">
          {withWarnings.map((n) => (
            <li key={n.node}>
              <span className="font-medium">{n.node}</span> ({n.from} → {n.to}):{' '}
              {n.warnings.join('; ')}
            </li>
          ))}
        </ul>
      )}
      {unsupported.length > 0 && (
        <ul className="grid list-disc gap-0.5 pl-5 text-xs text-amber-700 dark:text-amber-300">
          {unsupported.map((n) => (
            <li key={n.node}>
              <span className="font-medium">{n.node}</span>: {n.reason} (importado como marcador
              desabilitado)
            </li>
          ))}
        </ul>
      )}
      {report.expressionsToReview.length > 0 && (
        <div className="grid gap-0.5 text-xs">
          <p className="font-medium">Expressões a revisar</p>
          <ul className="list-disc pl-5">
            {report.expressionsToReview.map((e, k) => (
              <li key={`${e.node}-${String(k)}`}>
                {e.node} · {e.parameter}: {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.credentialsToCreate.length > 0 && (
        <div className="grid gap-0.5 text-xs">
          <p className="font-medium">Credenciais a cadastrar</p>
          <ul className="list-disc pl-5">
            {report.credentialsToCreate.map((c) => (
              <li key={`${c.n8nType}-${c.name}`}>
                “{c.name}” ({c.ollyType ?? `${c.n8nType}: sem tipo equivalente`}) — usada por{' '}
                {c.nodes.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.semanticNotes.length > 0 && (
        <ul className="grid list-disc gap-0.5 pl-5 text-xs text-muted-foreground">
          {report.semanticNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Importar workflow em JSON (spec 015, FR-010/FR-011): formato do Olly Flow ou do N8N, arquivo
 * ou texto colado, prévia com erros, pendências e relatório de migração, e criação do rascunho.
 */
export function ImportWorkflowDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<ImportFormat>('olly');
  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const reset = () => {
    setPreview(null);
  };
  const body = () => ({ format, content, ...(name.trim() && { name: name.trim() }) });

  const previewMutation = useMutation({
    mutationFn: () =>
      api.post<ImportPreview>(`/api/v1/projects/${projectId}/workflows/import/preview`, body()),
    onSuccess: (p) => {
      setPreview(p);
      if (!name.trim()) setName(p.name);
    },
    onError: (e) => toast.error('Não foi possível pré-visualizar', { description: e.message }),
  });
  const importMutation = useMutation({
    mutationFn: () =>
      api.post<{ workflow: WorkflowDetail; preview: ImportPreview; overwritten: boolean }>(
        `/api/v1/projects/${projectId}/workflows/import`,
        body(),
      ),
    onSuccess: ({ workflow, preview: p, overwritten }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflows(projectId) });
      // FR-028: o editor abre a versão nova do workflow sobreposto, não a do cache.
      queryClient.setQueryData(queryKeys.workflow(workflow.id), workflow);
      toast.success(
        overwritten
          ? `Workflow "${workflow.name}" sobreposto (versão ${String(workflow.version)})`
          : 'Workflow importado como rascunho',
        {
          description:
            p.pending.length > 0
              ? `${String(p.pending.length)} pendência(s) para resolver`
              : undefined,
        },
      );
      onOpenChange(false);
      void navigate(`/workflows/${workflow.id}`);
    },
    onError: (e) => toast.error('Não foi possível importar', { description: e.message }),
  });

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      setContent(text);
      if (!name.trim()) setName(file.name.replace(/\.json$/i, ''));
      reset();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setContent('');
          setName('');
          setPreview(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"
        data-testid="import-dialog"
      >
        <DialogHeader>
          <DialogTitle>Importar workflow</DialogTitle>
          <DialogDescription>
            Arquivo JSON baixado do Olly Flow (ou gerado por IA) ou exportado do N8N. O workflow é
            criado como rascunho; credenciais não são importadas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="import-format">Formato</Label>
            <Select
              id="import-format"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as ImportFormat);
                reset();
              }}
            >
              <option value="olly">Olly Flow</option>
              <option value="n8n">N8N</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="import-file">Arquivo</Label>
            <Input id="import-file" type="file" accept=".json,application/json" onChange={onFile} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="import-content">Conteúdo (JSON)</Label>
            <textarea
              id="import-content"
              spellCheck={false}
              className="min-h-32 w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder='{ "name": "...", "nodes": [...], "connections": {...} }'
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                reset();
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="import-name">Nome do workflow</Label>
            <Input
              id="import-name"
              value={name}
              placeholder="O nome do arquivo"
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </div>
          {preview && (
            <div className="grid gap-3 rounded-md bg-muted/40 p-3" data-testid="import-preview">
              <p className="text-sm">
                {preview.counts.nodes} nó(s) e {preview.counts.connections} conexão(ões).{' '}
                {preview.errors.length === 0 ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Pronto para importar.
                  </span>
                ) : (
                  <span className="text-destructive">Corrija os erros para importar.</span>
                )}
              </p>
              {preview.target && (
                <p
                  className="rounded-md border border-amber-500/60 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                  data-testid="import-target"
                >
                  Este arquivo corresponde ao workflow “{preview.target.name}” deste projeto (
                  {preview.target.matchedBy === 'id' ? 'mesmo identificador' : 'mesmo nome'}). A
                  importação vai <strong>sobrepor o rascunho</strong> dele como a versão{' '}
                  {preview.target.version + 1}; o histórico é mantido
                  {preview.target.published && ' e a versão publicada continua em produção'}.
                </p>
              )}
              <IssueList
                title="Erros"
                issues={preview.errors}
                tone="error"
                testId="import-errors"
              />
              <IssueList
                title="Pendências (resolva depois de importar)"
                issues={preview.pending}
                tone="pending"
                testId="import-pending"
              />
              <IssueList
                title="Avisos"
                issues={preview.warnings}
                tone="warning"
                testId="import-warnings"
              />
              <MigrationReportView preview={preview} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!content.trim() || previewMutation.isPending}
            onClick={() => {
              previewMutation.mutate();
            }}
          >
            {previewMutation.isPending && <Loader2 className="animate-spin" />}
            Pré-visualizar
          </Button>
          <Button
            disabled={!preview || preview.errors.length > 0 || importMutation.isPending}
            onClick={() => {
              importMutation.mutate();
            }}
          >
            {importMutation.isPending && <Loader2 className="animate-spin" />}
            {preview?.target ? 'Importar e sobrepor' : 'Importar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
