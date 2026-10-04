import type { WorkflowIssue, WorkflowNode } from '@olly/shared-types';
import { AlertTriangle, CircleX } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Erros (impedem salvar) e avisos da validação estrutural; clique seleciona os nós (FR-005). */
export function IssuesPanel({
  errors,
  warnings,
  nodes,
  onSelect,
}: {
  errors: WorkflowIssue[];
  warnings: WorkflowIssue[];
  nodes: WorkflowNode[];
  onSelect: (nodeIds: string[]) => void;
}) {
  if (errors.length === 0 && warnings.length === 0) return null;
  const names = (ids: string[]) =>
    ids.map((id) => nodes.find((n) => n.id === id)?.name ?? id).join(', ');
  const rows = [
    ...errors.map((issue) => ({ issue, error: true })),
    ...warnings.map((issue) => ({ issue, error: false })),
  ];
  return (
    <section
      aria-label="Problemas do workflow"
      data-testid="issues-panel"
      className="absolute top-3 left-1/2 z-10 max-h-40 w-[min(36rem,90%)] -translate-x-1/2 overflow-y-auto rounded-lg border bg-card p-2 text-sm shadow-lg"
    >
      <ul className="grid gap-1">
        {rows.map(({ issue, error }, i) => (
          <li key={`${issue.code}-${i}`}>
            <button
              type="button"
              onClick={() => {
                onSelect(issue.nodeIds);
              }}
              className={cn(
                'flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-accent',
                error ? 'text-destructive' : 'text-amber-700 dark:text-amber-300',
              )}
            >
              {error ? (
                <CircleX className="mt-0.5 size-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              )}
              <span>
                {issue.message}
                {issue.nodeIds.length > 0 && (
                  <span className="text-muted-foreground"> — {names(issue.nodeIds)}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
