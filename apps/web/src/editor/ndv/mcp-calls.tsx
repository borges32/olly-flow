import type { McpCall } from '@olly/shared-types';
import { useMcpCalls } from '@/api/queries';
import { Badge } from '@/components/ui/badge';

const STATUS: Record<
  McpCall['status'],
  { label: string; variant: 'default' | 'warning' | 'destructive' }
> = {
  success: { label: 'sucesso', variant: 'default' },
  error: { label: 'erro', variant: 'destructive' },
  denied: { label: 'negada', variant: 'warning' },
  blocked: { label: 'bloqueada', variant: 'warning' },
};

/**
 * Chamadas MCP do nó na execução (spec 010, FR-011): servidor, operação, argumentos já
 * mascarados (só com `execution:readData`), status, duração e tamanho do resultado.
 */
export function McpCallsPanel({
  executionId,
  nodeId,
  runIndex,
  status,
}: {
  executionId: string | undefined;
  nodeId: string;
  runIndex: number | undefined;
  /** Status do nó: a lista é relida quando ele termina. */
  status: string | undefined;
}) {
  const { data } = useMcpCalls(executionId, status);
  const calls = (data ?? []).filter(
    (c) => c.nodeId === nodeId && (runIndex === undefined || c.runIndex === runIndex),
  );
  if (calls.length === 0) return null;
  return (
    <section
      aria-label="Chamadas MCP"
      data-testid="ndv-mcp-calls"
      className="max-h-56 shrink-0 overflow-y-auto border-t"
    >
      <h4 className="sticky top-0 bg-background px-3 py-1.5 text-xs font-semibold">
        Chamadas MCP ({calls.length})
      </h4>
      <ul className="grid gap-2 px-3 pb-2 text-xs">
        {calls.map((c) => (
          <li key={c.id} className="grid gap-1 rounded border p-2" data-testid="mcp-call">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
              <span className="font-medium">{c.serverName}</span>
              <span className="font-mono">
                {c.operation}
                {c.target ? ` · ${c.target}` : ''}
              </span>
              <span className="ml-auto text-muted-foreground">
                item {c.itemIndex} · {c.durationMs} ms
                {c.resultBytes !== null && ` · ${c.resultBytes} B`}
              </span>
            </div>
            {c.arguments !== undefined && c.arguments !== null && (
              <pre className="overflow-x-auto rounded bg-muted p-1.5 font-mono text-[11px]">
                {JSON.stringify(c.arguments)}
              </pre>
            )}
            {c.error && <p className="text-destructive">{c.error}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
