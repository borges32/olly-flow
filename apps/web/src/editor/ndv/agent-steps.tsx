import type { AgentStep, AgentStepEvent } from '@olly/shared-types';
import { AlertTriangle, Bot, CheckCircle2, Hand, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { executionSocket } from '@/api/execution-socket';
import { useAgentSteps, useExecutionAiUsage } from '@/api/queries';
import { useAuth } from '@/auth/auth-provider';
import { Badge } from '@/components/ui/badge';
import { mergeSteps, stepKey, type StepView } from './agent-steps-logic';

const KIND: Record<AgentStep['kind'], { label: string; icon: typeof Bot }> = {
  model: { label: 'modelo', icon: Bot },
  tool: { label: 'ferramenta', icon: Wrench },
  approval: { label: 'aprovação', icon: Hand },
  final: { label: 'resposta', icon: CheckCircle2 },
  error: { label: 'erro', icon: AlertTriangle },
};

function preview(content: unknown): string {
  if (content === undefined || content === null) return '';
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 1);
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

/**
 * Passos do agente na execução (spec 011, FR-006): pensamento do modelo, chamadas de
 * ferramenta, aprovações e resposta, ao vivo durante a execução. O conteúdo vem mascarado e só
 * aparece para quem lê os dados da execução.
 */
export function AgentStepsPanel({
  executionId,
  nodeId,
  runIndex,
  status,
}: {
  executionId: string | undefined;
  nodeId: string;
  runIndex: number | undefined;
  /** Status do nó: a lista é relida quando ele muda. */
  status: string | undefined;
}) {
  const { getAccessToken } = useAuth();
  const { data } = useAgentSteps(executionId, status);
  const { data: usage } = useExecutionAiUsage(executionId, status);
  const [live, setLive] = useState<{ executionId: string; steps: StepView[] }>({
    executionId: '',
    steps: [],
  });

  useEffect(() => {
    if (!executionId) return;
    const socket = executionSocket(getAccessToken);
    const onStep = (e: AgentStepEvent) => {
      if (e.executionId !== executionId || e.nodeId !== nodeId) return;
      setLive((prev) => ({
        executionId,
        steps: [...(prev.executionId === executionId ? prev.steps : []), e],
      }));
    };
    socket.on('agentStep', onStep);
    return () => {
      socket.off('agentStep', onStep);
    };
  }, [executionId, nodeId, getAccessToken]);

  const steps = useMemo(
    () =>
      mergeSteps(
        (data ?? []).filter((s) => s.nodeId === nodeId),
        live.executionId === executionId ? live.steps : [],
      ).filter((s) => runIndex === undefined || s.runIndex === runIndex),
    [data, live, nodeId, runIndex, executionId],
  );
  if (steps.length === 0 && status !== 'waiting') return null;
  return (
    <section
      aria-label="Passos do agente"
      data-testid="ndv-agent-steps"
      className="max-h-72 shrink-0 overflow-y-auto border-t"
    >
      <h4 className="sticky top-0 flex items-center gap-2 bg-background px-3 py-1.5 text-xs font-semibold">
        Passos do agente ({steps.length})
        {usage && usage.calls > 0 && (
          <span className="ml-auto font-normal text-muted-foreground" data-testid="agent-usage">
            {usage.inputTokens + usage.outputTokens} tokens
            {usage.cost !== null && ` · ≈ ${usage.cost.toFixed(4)} ${usage.currency ?? 'USD'}`}
          </span>
        )}
      </h4>
      {status === 'waiting' && (
        <p className="mx-3 mb-2 rounded border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
          Aguardando aprovação humana de uma ação.{' '}
          <Link to="/approvals" className="font-medium underline">
            Abrir Aprovações
          </Link>
        </p>
      )}
      <ol className="grid gap-1.5 px-3 pb-2 text-xs">
        {steps.map((s) => {
          const { label, icon: Icon } = KIND[s.kind];
          const tokens = (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
          return (
            <li key={stepKey(s)} className="grid gap-1 rounded border p-2" data-testid="agent-step">
              <div className="flex flex-wrap items-center gap-2">
                <Icon className="size-3.5 text-muted-foreground" />
                <Badge variant="outline">{label}</Badge>
                {s.toolName && <span className="font-mono">{s.toolName}</span>}
                <span className="ml-auto text-muted-foreground">
                  item {s.itemIndex}
                  {tokens > 0 && ` · ${String(tokens)} tokens`}
                </span>
              </div>
              {s.content !== undefined ? (
                <pre className="max-h-40 overflow-auto rounded bg-muted p-1.5 font-mono text-[11px] whitespace-pre-wrap">
                  {preview(s.content)}
                </pre>
              ) : (
                <p className="text-muted-foreground italic">
                  Conteúdo oculto: exige permissão para ver os dados da execução.
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
