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
  /** Volta de um laço para a porta `continue` (spec 007, FR-016): desenhada por baixo. */
  back?: boolean;
  /** Aresta de um ciclo inválido: destacada, com a regra no tooltip (FR-016). */
  invalidReason?: string;
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
  const [bezier, bezierX, bezierY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  // Aresta de retorno: sai pela direita, passa por baixo dos nós e entra pela esquerda.
  const below = Math.max(sourceY, targetY) + 90;
  const [path, labelX, labelY] = data?.back
    ? [
        `M ${sourceX} ${sourceY} C ${sourceX + 120} ${sourceY}, ${sourceX + 120} ${below}, ${sourceX} ${below} L ${targetX} ${below} C ${targetX - 120} ${below}, ${targetX - 120} ${targetY}, ${targetX} ${targetY}`,
        (sourceX + targetX) / 2,
        below,
      ]
    : [bezier, bezierX, bezierY];
  const showDelete = !data?.readOnly && (selected === true || data?.hovered === true);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={24}
        className={cn(data?.back && 'olly-back-edge', data?.invalidReason && 'olly-invalid-edge')}
        style={{
          stroke: selected
            ? 'var(--primary)'
            : data?.invalidReason
              ? 'var(--destructive)'
              : data?.back
                ? 'rgb(245 158 11)'
                : undefined,
          strokeWidth: selected || data?.hovered ? 2.5 : 1.5,
          ...((data?.back || data?.invalidReason) && { strokeDasharray: '6 4' }),
        }}
      />
      {data?.invalidReason && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute rounded-full border border-destructive bg-card px-1.5 text-[10px] font-medium text-destructive"
            style={{ transform: `translate(-50%, -150%) translate(${labelX}px, ${labelY}px)` }}
            title={data.invalidReason}
            data-testid="invalid-cycle-badge"
          >
            ciclo inválido
          </div>
        </EdgeLabelRenderer>
      )}
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
