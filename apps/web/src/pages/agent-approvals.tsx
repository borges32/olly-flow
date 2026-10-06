import type { AgentApproval, ApprovalStatus } from '@olly/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { useAgentApprovals } from '@/api/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'pendente',
  approved: 'aprovada',
  rejected: 'rejeitada',
  expired: 'expirada',
  cancelled: 'cancelada',
};

/**
 * Ações do agente aguardando aprovação humana (spec 011, FR-010, FR-011): ferramenta,
 * argumentos (mascarados), motivo e prazo. Aprovar ou rejeitar retoma a execução.
 */
export function AgentApprovalsSection() {
  const pending = useAgentApprovals('pending');
  const decided = useAgentApprovals('decided');
  return (
    <>
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle role="heading" aria-level={2}>
            Ações do agente aguardando aprovação
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 px-4" data-testid="agent-approvals-pending">
          {(pending.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma ação pendente.</p>
          )}
          {(pending.data ?? []).map((a) => (
            <AgentDecision key={a.id} approval={a} />
          ))}
        </CardContent>
      </Card>
      {(decided.data ?? []).length > 0 && (
        <Card className="gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle role="heading" aria-level={2}>
              Ações do agente decididas
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 px-4" data-testid="agent-approvals-decided">
            {(decided.data ?? []).slice(0, 50).map((a) => (
              <div key={a.id} className="grid gap-0.5 border-b pb-2 text-sm last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{a.tool}</span>
                  <Link to={`/executions/${a.executionId}`} className="hover:underline">
                    {a.workflowName}
                  </Link>
                  <span className="text-muted-foreground">{a.projectName}</span>
                  <Badge variant={a.status === 'approved' ? 'default' : 'secondary'}>
                    {STATUS_LABELS[a.status]}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {a.decidedAt && dateFormat.format(new Date(a.decidedAt))}
                  </span>
                </div>
                {(a.decidedByName || a.comment) && (
                  <p className="text-xs text-muted-foreground">
                    {a.decidedByName ? `por ${a.decidedByName}` : ''}
                    {a.comment ? `: ${a.comment}` : ''}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function AgentDecision({ approval: a }: { approval: AgentApproval }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const decide = useMutation({
    mutationFn: (action: 'approve' | 'reject') =>
      api.post<AgentApproval>(`/api/v1/approvals/${a.id}/${action}`, {
        ...(comment.trim() && { comment: comment.trim() }),
      }),
    onSuccess: (res) => {
      toast.success(res.status === 'approved' ? 'Ação aprovada' : 'Ação rejeitada', {
        description: 'A execução retoma em seguida.',
      });
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (e) => {
      toast.error('Decisão não registrada', {
        description: e instanceof ApiError ? e.message : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
  return (
    <div
      className="grid gap-2 rounded-md border p-3 text-sm"
      data-testid={`agent-approval-${a.tool}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-medium">{a.tool}</span>
        <Link to={`/executions/${a.executionId}`} className="hover:underline">
          {a.workflowName}
        </Link>
        <span className="text-muted-foreground">
          {a.projectName} · item {a.itemIndex}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          expira {dateFormat.format(new Date(a.expiresAt))}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{a.reason}</p>
      <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
        {JSON.stringify(a.arguments, null, 2)}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Comentário"
          className="max-w-md"
          placeholder="Comentário (opcional; volta ao agente na rejeição)"
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
          <Check /> Aprovar ação
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
