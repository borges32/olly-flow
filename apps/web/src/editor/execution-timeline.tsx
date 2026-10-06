import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { NodeRunView } from './store';
import type { TimelineRow } from './timeline';

const BAR_COLOR: Partial<Record<NodeRunView['status'], string>> = {
  running: 'fill-primary animate-pulse',
  success: 'fill-emerald-500',
  error: 'fill-destructive',
  cancelled: 'fill-amber-500',
  waiting: 'fill-sky-500',
};

const formatMs = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;

/**
 * Linha do tempo da execução (spec 006, FR-013): um Gantt simples em SVG com o início e a
 * duração de cada nó. Nós em paralelo aparecem com barras sobrepostas no tempo.
 */
export function ExecutionTimeline({ rows }: { rows: TimelineRow[] }) {
  const running = rows.some((r) => r.end === null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 200);
    return () => {
      clearInterval(timer);
    };
  }, [running]);

  if (rows.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">Nenhum nó executado ainda.</p>;
  }
  const origin = Math.min(...rows.map((r) => r.start));
  const finish = Math.max(...rows.map((r) => r.end ?? now));
  const total = Math.max(finish - origin, 1);
  const rowHeight = 22;
  const pct = (ms: number) => (ms / total) * 100;

  return (
    <div
      className="grid grid-cols-[10rem_1fr] gap-x-3 p-3 text-xs"
      data-testid="execution-timeline"
    >
      <div />
      <div className="flex justify-between pb-1 text-muted-foreground">
        <span>0</span>
        <span data-testid="timeline-total">{formatMs(total)}</span>
      </div>
      {rows.map((row) => {
        const end = row.end ?? now;
        const duration = end - row.start;
        return (
          <div key={row.nodeId} className="contents" data-testid={`timeline-row-${row.name}`}>
            <span className="truncate py-0.5" title={row.name}>
              {row.name}
            </span>
            <svg
              className="w-full overflow-visible"
              height={rowHeight}
              role="img"
              aria-label={`${row.name}: ${formatMs(duration)}`}
            >
              <title>{`${row.name}: início em ${formatMs(row.start - origin)}, duração ${formatMs(duration)}`}</title>
              <rect
                x={`${pct(row.start - origin)}%`}
                y={4}
                width={`${Math.max(pct(duration), 0.5)}%`}
                height={rowHeight - 8}
                rx={3}
                className={cn(BAR_COLOR[row.status] ?? 'fill-muted-foreground')}
                data-start={row.start - origin}
                data-duration={duration}
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
