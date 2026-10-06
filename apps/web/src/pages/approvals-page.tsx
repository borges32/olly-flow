import type { PublishApproval, PublishApprovalStatus } from '@olly/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { usePublishRequests } from '@/api/queries';
import { useMe } from '@/api/use-me';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AgentApprovalsSection } from './agent-approvals';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const STATUS_LABELS: Record<PublishApprovalStatus, string> = {
  pending: 'pendente',
  approved: 'aprovado',
  rejected: 'rejeitado',
  cancelled: 'cancelado',
};

/**
 * Aprovações: ações do agente (spec 011, FR-011) e publicação (spec 009, FR-011): pedidos
 * aguardando decisão (de outras pessoas) e o andamento dos próprios pedidos.
 */
export function ApprovalsPage() {
  const me = useMe().data;
  const requests = usePublishRequests({});
  const all = requests.data ?? [];
  const toDecide = all.filter((r) => r.status === 'pending' && r.requestedBy.id !== me?.id);
  const mine = all.filter((r) => r.requestedBy.id === me?.id);
  const others = all.filter((r) => r.status !== 'pending' && r.requestedBy.id !== me?.id);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Aprovações</h1>
      <AgentApprovalsSection />
      <h2 className="text-lg font-semibold tracking-tight">Publicação</h2>
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle role="heading" aria-level={2}>
            Aguardando sua decisão
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 px-4" data-testid="approvals-pending">
          {toDecide.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum pedido pendente.</p>
          )}
          {toDecide.map((r) => (
            <Decision key={r.id} request={r} />
          ))}
        </CardContent>
      </Card>
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle role="heading" aria-level={2}>
            Meus pedidos
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 px-4" data-testid="approvals-mine">
          {mine.length === 0 && <p className="text-sm text-muted-foreground">Nenhum pedido.</p>}
          {mine.map((r) => (
            <RequestLine key={r.id} request={r} />
          ))}
        </CardContent>
      </Card>
      {others.length > 0 && (
        <Card className="gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle role="heading" aria-level={2}>
              Decididos
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 px-4">
            {others.map((r) => (
              <RequestLine key={r.id} request={r} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RequestLine({ request: r }: { request: PublishApproval }) {
  return (
    <div className="grid gap-0.5 border-b pb-2 text-sm last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/workflows/${r.workflowId}`} className="font-medium hover:underline">
          {r.workflowName}
        </Link>
        <span className="text-muted-foreground">
          v{r.version} · {r.projectName}
        </span>
        <Badge variant={r.status === 'approved' ? 'default' : 'secondary'}>
          {STATUS_LABELS[r.status]}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {dateFormat.format(new Date(r.createdAt))}
        </span>
      </div>
      <p className="text-xs">“{r.message}”</p>
      {r.decidedBy && (
        <p className="text-xs text-muted-foreground">
          {STATUS_LABELS[r.status]} por {r.decidedBy.name ?? r.decidedBy.email}
          {r.comment ? `: ${r.comment}` : ''}
        </p>
      )}
    </div>
  );
}

function Decision({ request: r }: { request: PublishApproval }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const decide = useMutation({
    mutationFn: (action: 'approve' | 'reject') =>
      api.post<PublishApproval>(`/api/v1/publish-requests/${r.id}/${action}`, {
        ...(comment.trim() && { comment: comment.trim() }),
      }),
    onSuccess: (res) => {
      toast.success(res.status === 'approved' ? 'Publicação aprovada' : 'Pedido rejeitado');
      void queryClient.invalidateQueries({ queryKey: ['publish-requests'] });
    },
    onError: (e) =>
      toast.error('Decisão não registrada', {
        description:
          e instanceof ApiError
            ? [e.message, ...e.issues.map((i) => i.message)].join(' — ')
            : undefined,
      }),
  });
  return (
    <div
      className="grid gap-2 rounded-md border p-3 text-sm"
      data-testid={`approval-${r.workflowName}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/workflows/${r.workflowId}`} className="font-medium hover:underline">
          {r.workflowName}
        </Link>
        <span className="text-muted-foreground">
          v{r.version} · {r.projectName} · pedido por {r.requestedBy.name ?? r.requestedBy.email}
        </span>
      </div>
      <p>“{r.message}”</p>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Comentário"
          className="max-w-md"
          placeholder="Comentário (opcional)"
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
          }}
        />
        <Button
          size="sm"
          disabled={decide.isPending}
          onClick={() => {
            decide.mutate('approve');
          }}
        >
          <Check /> Aprovar e publicar
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={decide.isPending}
          onClick={() => {
            decide.mutate('reject');
          }}
        >
          <X /> Rejeitar
        </Button>
      </div>
    </div>
  );
}
