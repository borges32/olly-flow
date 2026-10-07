import type { WorkflowDetail, WorkflowFile, WorkflowSummary } from '@olly/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { queryKeys, useProjects, useWorkflows } from '@/api/queries';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { downloadJson } from '@/editor/workflow-file-io';
import { ImportWorkflowDialog } from './import-workflow-dialog';

const PAGE_SIZE = 20;
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Listagem paginada de workflows do projeto (spec 002, FR-001, plan §8). */
export function WorkflowsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: projects } = useProjects();
  const projectId = params.get('project') ?? projects?.[0]?.id;
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const workflows = useWorkflows(projectId, page, PAGE_SIZE);
  const canCreate = useCan('workflow:create', projectId);
  const canDelete = useCan('workflow:delete', projectId);
  // Spec 015, FR-008: só Editor e Admin do projeto baixam.
  const canDownload = useCan('workflow:update', projectId);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [toDelete, setToDelete] = useState<WorkflowSummary | null>(null);

  const create = useMutation({
    mutationFn: (name: string) =>
      api.post<WorkflowDetail>(`/api/v1/projects/${projectId ?? ''}/workflows`, { name }),
    onSuccess: (wf) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflows(wf.projectId) });
      void navigate(`/workflows/${wf.id}`);
    },
    onError: (e) => toast.error('Não foi possível criar o workflow', { description: e.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/workflows/${id}`),
    onSuccess: () => {
      setToDelete(null);
      toast.success('Workflow excluído');
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflows(projectId ?? '') });
    },
    onError: (e) =>
      toast.error('Não foi possível excluir', {
        description: e instanceof ApiError ? e.message : undefined,
      }),
  });

  // Spec 015, FR-006: baixa o rascunho salvo como JSON.
  const download = async (wf: WorkflowSummary) => {
    try {
      const file = await api.get<WorkflowFile>(`/api/v1/workflows/${wf.id}/export`);
      downloadJson(file, `${wf.name}.json`);
    } catch (e) {
      toast.error('Não foi possível baixar o workflow', {
        description: e instanceof ApiError ? e.message : undefined,
      });
    }
  };

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (newName.trim()) create.mutate(newName.trim());
  };

  if (projects && projects.length === 0) {
    return (
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        <p className="text-muted-foreground">
          Você ainda não participa de nenhum projeto. Peça acesso a um administrador.
        </p>
      </div>
    );
  }

  const data = workflows.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="flex-1 text-2xl font-semibold tracking-tight">Workflows</h1>
        <div className="grid gap-1.5">
          <Label htmlFor="project-select">Projeto</Label>
          <Select
            id="project-select"
            className="w-64"
            value={projectId ?? ''}
            onChange={(e) => {
              setParams({ project: e.target.value });
            }}
          >
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        {canCreate && (
          <Button
            variant="outline"
            onClick={() => {
              setImporting(true);
            }}
          >
            <Upload /> Importar
          </Button>
        )}
        {canCreate && (
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> Novo workflow
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Versão</th>
              <th className="px-4 py-2 font-medium">Atualizado em</th>
              {(canDelete || canDownload) && <th className="w-24 px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((wf) => (
              <tr key={wf.id} className="border-t">
                <td className="px-4 py-2">
                  <Link to={`/workflows/${wf.id}`} className="font-medium hover:underline">
                    {wf.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">v{wf.version}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {dateFormat.format(new Date(wf.updatedAt))}
                </td>
                {(canDelete || canDownload) && (
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {canDownload && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Baixar ${wf.name}`}
                        title="Baixar como JSON"
                        onClick={() => void download(wf)}
                      >
                        <Download />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Excluir ${wf.name}`}
                        onClick={() => {
                          setToDelete(wf);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhum workflow neste projeto.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              setParams({ project: projectId ?? '', page: String(page - 1) });
            }}
          >
            Anterior
          </Button>
          <span className="text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => {
              setParams({ project: projectId ?? '', page: String(page + 1) });
            }}
          >
            Próxima
          </Button>
        </div>
      )}

      {projectId && (
        <ImportWorkflowDialog projectId={projectId} open={importing} onOpenChange={setImporting} />
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <form onSubmit={onCreate} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Novo workflow</DialogTitle>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="new-workflow-name">Nome</Label>
              <Input
                id="new-workflow-name"
                autoFocus
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                }}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!newName.trim() || create.isPending}>
                Criar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir workflow?</DialogTitle>
            <DialogDescription>
              “{toDelete?.name}” deixará de aparecer na lista. O histórico de versões é mantido.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setToDelete(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (toDelete) remove.mutate(toDelete.id);
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
