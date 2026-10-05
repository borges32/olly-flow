import type { NodeRunView } from './store';

export interface TimelineRow {
  nodeId: string;
  name: string;
  status: NodeRunView['status'];
  start: number;
  /** `null`: ainda executando (a barra cresce até agora). */
  end: number | null;
}

/** Linhas da linha do tempo a partir do estado da execução (início e duração de cada nó). */
export function timelineRows(
  runNodes: Record<string, NodeRunView>,
  names: Record<string, string>,
): TimelineRow[] {
  return Object.entries(runNodes)
    .filter(([, n]) => n.startedAt !== undefined && n.status !== 'skipped' && !n.reused)
    .map(([nodeId, n]) => {
      const start = Date.parse(n.startedAt ?? '');
      return {
        nodeId,
        name: names[nodeId] ?? nodeId,
        status: n.status,
        start,
        end: n.status === 'running' ? null : start + (n.durationMs ?? 0),
      };
    })
    .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
}
