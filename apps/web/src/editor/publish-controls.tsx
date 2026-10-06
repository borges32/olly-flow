import type { PublishApproval, PublishResponse, WorkflowDetail } from '@olly/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { Clock, PowerOff, Rocket } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { queryKeys, useProjectSettings, usePublishRequests } from '@/api/queries';
import { useMe } from '@/api/use-me';
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
import { Label } from '@/components/ui/label';

const describe = (error: unknown) =>
  error instanceof ApiError
    ? [error.message, ...error.issues.map((i) => i.message)].join(' — ')
    : undefined;

/**
 * Publicação (spec 005, FR-001/FR-002): publica a versão salva e mostra qual versão está em
 * produção. A produção só muda ao publicar de novo.
 *
 * Spec 009: a mensagem é obrigatória (FR-009); com aprovação ativa no projeto, publicar abre um
 * pedido que outra pessoa aprova (FR-011), e o pedido pendente aparece aqui.
 */
export function PublishControls({
  workflow,
  dirty,
  canPublish,
}: {
  workflow: WorkflowDetail;
  dirty: boolean;
  canPublish: boolean;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const settings = useProjectSettings(workflow.projectId);
  const requiresApproval = settings.data?.requirePublishApproval ?? false;
  const pendingFilter = { workflowId: workflow.id, status: 'pending' };
  const pending = usePublishRequests(pendingFilter, requiresApproval).data?.[0];
  const me = useMe().data;

  const apply = (res: PublishResponse) => {
    queryClient.setQueryData<WorkflowDetail>(queryKeys.workflow(workflow.id), (old) =>
      old ? { ...old, publishedVersion: res.publishedVersion, active: res.active } : old,
    );
    void queryClient.invalidateQueries({ queryKey: ['publish-requests'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.versions(workflow.id) });
  };

  const publish = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<PublishResponse>(`/api/v1/workflows/${workflow.id}/publish`, {
        version: workflow.version,
        message: message.trim(),
      });
      apply(res);
      setOpen(false);
      setMessage('');
      if (res.pendingApproval) {
        toast.success('Pedido de publicação enviado', {
          description: 'Outra pessoa com permissão de publicar precisa aprovar.',
        });
      } else {
        toast.success(`Versão ${String(res.publishedVersion)} publicada`, {
          description: res.warnings.map((w) => w.message).join('\n') || undefined,
        });
      }
    } catch (error) {
      toast.error('Não foi possível publicar', { description: describe(error) });
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    setBusy(true);
    try {
      apply(await api.post<PublishResponse>(`/api/v1/workflows/${workflow.id}/unpublish`, {}));
      toast.success('Workflow despublicado');
    } catch (error) {
      toast.error('Não foi possível despublicar', { description: describe(error) });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (request: PublishApproval) => {
    try {
      await api.post(`/api/v1/publish-requests/${request.id}/cancel`, {});
      void queryClient.invalidateQueries({ queryKey: ['publish-requests'] });
      toast.success('Pedido cancelado');
    } catch (error) {
      toast.error('Não foi possível cancelar', { description: describe(error) });
    }
  };

  const published = workflow.active && workflow.publishedVersion !== null;
  return (
    <div className="flex items-center gap-2">
      <Badge variant={published ? 'default' : 'secondary'} data-testid="publish-badge">
        {published
          ? `Publicada v${String(workflow.publishedVersion)}${workflow.publishedVersion !== workflow.version ? ` · rascunho v${String(workflow.version)}` : ''}`
          : 'Não publicada'}
      </Badge>
      {pending && (
        <Badge
          variant="outline"
          className="gap-1 border-amber-500 text-amber-700 dark:text-amber-400"
          data-testid="publish-pending"
          title={`Pedido de ${pending.requestedBy.name ?? pending.requestedBy.email}: “${pending.message}”`}
        >
          <Clock className="size-3" /> v{pending.version} aguardando aprovação
        </Badge>
      )}
      {canPublish && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || dirty || pending !== undefined}
            title={
              dirty
                ? 'Salve antes de publicar'
                : pending
                  ? 'Já existe um pedido de publicação pendente'
                  : `Publicar a versão ${String(workflow.version)}`
            }
            onClick={() => {
              setOpen(true);
            }}
          >
            <Rocket /> {requiresApproval ? 'Pedir publicação' : 'Publicar'}
          </Button>
          {pending?.requestedBy.id === me?.id && pending && (
            <Button size="sm" variant="ghost" onClick={() => void cancel(pending)}>
              Cancelar pedido
            </Button>
          )}
          {published && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void unpublish()}>
              <PowerOff /> Despublicar
            </Button>
          )}
        </>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="publish-dialog">
          <form onSubmit={(e) => void publish(e)} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>
                {requiresApproval ? 'Pedir publicação' : 'Publicar'} a versão{' '}
                {String(workflow.version)}
              </DialogTitle>
              <DialogDescription>
                {requiresApproval
                  ? 'Este projeto exige aprovação: outra pessoa com permissão de publicar precisa aprovar o pedido.'
                  : 'A versão publicada passa a atender as execuções de produção.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="publish-message">Mensagem da publicação</Label>
              <Input
                id="publish-message"
                required
                autoFocus
                maxLength={500}
                placeholder="O que muda nesta versão"
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                }}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !message.trim()}>
                <Rocket /> {requiresApproval ? 'Enviar pedido' : 'Publicar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
