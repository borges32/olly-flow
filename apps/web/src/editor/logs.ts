import type { NodeRunView } from './store';

export interface LogEntry {
  nodeId: string;
  name: string;
  status: NodeRunView['status'];
  /** Início em ms; ausente nos nós reaproveitados ou fixados, que não executaram agora. */
  start?: number;
  durationMs?: number;
  itemsIn: number;
  itemsOut: number;
  reused: boolean;
  pinned: boolean;
}

/**
 * Logs da execução do editor (spec 021, FR-016): os nós que executaram (ou foram reaproveitados)
 * na ordem de início, como o painel "Logs" do N8N. Nós pulados ficam de fora.
 */
export function logEntries(
  runNodes: Record<string, NodeRunView>,
  names: Record<string, string>,
): LogEntry[] {
  return Object.entries(runNodes)
    .filter(([, n]) => n.status !== 'skipped')
    .map(([nodeId, n]): LogEntry => {
      const start = n.startedAt ? Date.parse(n.startedAt) : Number.NaN;
      return {
        nodeId,
        name: names[nodeId] ?? nodeId,
        status: n.status,
        ...(Number.isFinite(start) && { start }),
        ...(n.durationMs !== undefined && { durationMs: n.durationMs }),
        itemsIn: n.itemsIn,
        itemsOut: n.itemsOut,
        reused: n.reused,
        pinned: n.pinned,
      };
    })
    .sort(
      (a, b) =>
        (a.start ?? Number.NEGATIVE_INFINITY) - (b.start ?? Number.NEGATIVE_INFINITY) ||
        a.name.localeCompare(b.name),
    );
}

/** Nó mostrado ao abrir os logs: o último que terminou com erro ou, sem erro, o último. */
export function defaultLogSelection(entries: LogEntry[]): string | undefined {
  const failed = entries.filter((e) => e.status === 'error');
  return (failed.at(-1) ?? entries.at(-1))?.nodeId;
}

export const formatDuration = (ms: number | undefined) =>
  ms === undefined
    ? ''
    : ms < 1000
      ? `${String(Math.round(ms))} ms`
      : `${(ms / 1000).toFixed(2)} s`;
