import { useRef, type RefObject } from 'react';
import { DEFAULT_COLUMN_SIZES, resizeColumns, type ColumnSizes } from './column-sizes';

const KEY_STEP = 2;

/**
 * Divisória arrastável entre duas colunas (FR-001 a FR-003): arrastar, setas ← e → e clique
 * duplo (volta ao padrão). Só aparece na tela larga; na estreita, as colunas ficam empilhadas.
 */
export function ColumnHandle({
  handle,
  label,
  sizes,
  onResize,
  container,
}: {
  handle: 0 | 1;
  label: string;
  sizes: ColumnSizes;
  onResize: (sizes: ColumnSizes, persist: boolean) => void;
  container: RefObject<HTMLElement | null>;
}) {
  const drag = useRef<{ x: number; width: number; start: ColumnSizes; last: ColumnSizes } | null>(
    null,
  );
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={sizes[handle]}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      title="Arraste para ajustar a largura; clique duplo volta ao padrão"
      data-testid={`ndv-resize-${String(handle)}`}
      className="group relative hidden w-1.5 cursor-col-resize touch-none select-none focus-visible:outline-none lg:block"
      onPointerDown={(e) => {
        const width = container.current?.getBoundingClientRect().width ?? 0;
        if (width <= 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width, start: sizes, last: sizes };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.last = resizeColumns(d.start, handle, ((e.clientX - d.x) / d.width) * 100);
        onResize(d.last, false);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        onResize(d.last, true);
      }}
      onDoubleClick={() => {
        onResize([...DEFAULT_COLUMN_SIZES], true);
      }}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0;
        if (!step) return;
        e.preventDefault();
        onResize(resizeColumns(sizes, handle, step), true);
      }}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-primary group-focus-visible:w-0.5 group-focus-visible:bg-primary" />
    </div>
  );
}
