import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { useEditorStore } from './store';

export type OllyEdgeData = {
  /** Mouse sobre a conexão ou sobre o botão. */
  hovered: boolean;
  readOnly: boolean;
  onHover: (edgeId: string | null) => void;
};
export type OllyFlowEdge = Edge<OllyEdgeData, 'olly'>;

/**
 * Conexão com destaque quando selecionada e botão de excluir no meio, visível ao passar o
 * mouse ou ao selecionar (FR-007 da spec 002), como no N8N.
 */
export const WorkflowEdgeView = memo(function WorkflowEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
  markerEnd,
}: EdgeProps<OllyFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const showDelete = !data?.readOnly && (selected === true || data?.hovered === true);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={24}
        style={{
          stroke: selected ? 'var(--primary)' : undefined,
          strokeWidth: selected || data?.hovered ? 2.5 : 1.5,
        }}
      />
      {showDelete && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onMouseEnter={() => data?.onHover(id)}
            onMouseLeave={() => data?.onHover(null)}
          >
            <button
              type="button"
              aria-label="Excluir conexão"
              title="Excluir conexão (ou selecione e tecle Delete)"
              onClick={(e) => {
                e.stopPropagation();
                data?.onHover(null);
                useEditorStore.getState().removeEdge(id);
              }}
              className={cn(
                'flex size-6 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm',
                'hover:border-destructive hover:text-destructive',
              )}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
