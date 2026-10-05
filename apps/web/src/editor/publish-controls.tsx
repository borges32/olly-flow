import type { PublishResponse, WorkflowDetail } from '@olly/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { Rocket, PowerOff } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { queryKeys } from '@/api/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Publicação (spec 005, FR-001/FR-002): publica a versão salva e mostra qual versão está em
 * produção. A produção só muda ao publicar de novo.
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

  const apply = (res: PublishResponse) => {
    queryClient.setQueryData<WorkflowDetail>(queryKeys.workflow(workflow.id), (old) =>
      old ? { ...old, publishedVersion: res.publishedVersion, active: res.active } : old,
    );
  };
  const call = async (action: 'publish' | 'unpublish') => {
    setBusy(true);
    try {
      const res = await api.post<PublishResponse>(
        `/api/v1/workflows/${workflow.id}/${action}`,
        action === 'publish' ? { version: workflow.version } : {},
      );
      apply(res);
      if (action === 'publish') {
        toast.success(`Versão ${String(res.publishedVersion)} publicada`, {
          description: res.warnings.map((w) => w.message).join('\n') || undefined,
        });
      } else toast.success('Workflow despublicado');
    } catch (error) {
      toast.error(
        action === 'publish' ? 'Não foi possível publicar' : 'Não foi possível despublicar',
        {
          description:
            error instanceof ApiError
              ? [error.message, ...error.issues.map((i) => i.message)].join(' — ')
              : undefined,
        },
      );
    } finally {
      setBusy(false);
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
      {canPublish && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || dirty}
            title={
              dirty ? 'Salve antes de publicar' : `Publicar a versão ${String(workflow.version)}`
            }
            onClick={() => void call('publish')}
          >
            <Rocket /> Publicar
          </Button>
          {published && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void call('unpublish')}
            >
              <PowerOff /> Despublicar
            </Button>
          )}
        </>
      )}
    </div>
  );
}
