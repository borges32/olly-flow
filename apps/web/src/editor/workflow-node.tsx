import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { NodeDescription } from '@olly/nodes';
import type { WorkflowNode } from '@olly/shared-types';
import { AlertTriangle, Check, Loader2, Minus, Pin, Play, Square, X } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { useNodeActions } from './node-actions';
import { NodeIcon } from './node-icon';
import type { NodeRunView } from './store';

export type OllyNodeData = {
  node: WorkflowNode;
  description: NodeDescription | undefined;
  errors: string[];
  /** Estado na última execução de teste (FR-012). */
  run?: NodeRunView;
  pinned: boolean;
};

function RunStatus({ run }: { run: NodeRunView }) {
  const common =
    'absolute -bottom-2.5 right-2 flex items-center gap-1 rounded-full border bg-card px-1.5 py-0.5 text-[10px] font-medium shadow-sm';
  switch (run.status) {
    case 'running':
      return (
        <span
          data-testid="node-status"
          data-status="running"
          className={cn(common, 'text-primary')}
        >
          <Loader2 className="size-3 animate-spin" /> executando
        </span>
      );
    case 'success':
      return (
        <span
          data-testid="node-status"
          data-status="success"
          className={cn(common, 'text-emerald-600 dark:text-emerald-400')}
          title={
            run.reused
              ? `${run.itemsOut} itens (dados da execução anterior)`
              : `${run.itemsOut} itens em ${run.durationMs ?? 0} ms`
          }
        >
          <Check className="size-3" /> {run.itemsOut} {run.itemsOut === 1 ? 'item' : 'itens'}
        </span>
      );
    case 'error':
      return (
        <span
          data-testid="node-status"
          data-status="error"
          className={cn(common, 'text-destructive')}
          title={run.error?.message}
        >
          <X className="size-3" /> erro
        </span>
      );
    case 'cancelled':
      return (
        <span
          data-testid="node-status"
          data-status="cancelled"
          className={cn(common, 'text-amber-600 dark:text-amber-400')}
          title={run.error?.message ?? 'Execução interrompida'}
        >
          <Square className="size-3" /> interrompido
        </span>
      );
    default:
      return (
        <span
          data-testid="node-status"
          data-status={run.status}
          className={cn(common, 'text-muted-foreground')}
          title="Sem dados de entrada: não executou"
        >
          <Minus className="size-3" /> sem dados
        </span>
      );
  }
}
export type OllyFlowNode = Node<OllyNodeData, 'olly'>;

const handleOffset = (index: number, total: number) => `${((index + 1) / (total + 1)) * 100}%`;

/** Nó no canvas: ícone, nome, portas nomeadas e destaque de erro (FR-005, FR-007). */
export const WorkflowNodeView = memo(function WorkflowNodeView({
  data,
  selected,
}: NodeProps<OllyFlowNode>) {
  const { node, description, errors, run, pinned } = data;
  const actions = useNodeActions();
  const inputs = description?.inputs ?? [];
  const outputs = description?.outputs ?? [];
  const hasError = errors.length > 0;
  return (
    <div
      data-testid={`node-${node.name}`}
      data-x={node.position[0]}
      data-y={node.position[1]}
      title={hasError ? errors.join('\n') : undefined}
      className={cn(
        'group relative flex min-w-44 items-center gap-2 rounded-lg border-2 bg-card px-3 py-2 text-card-foreground shadow-sm',
        selected ? 'border-primary' : 'border-border',
        hasError && 'border-destructive',
        node.disabled && 'opacity-50',
        run?.status === 'error' && 'border-destructive',
        run?.status === 'running' && 'border-primary ring-2 ring-primary/30',
      )}
    >
      {inputs.map((port, i) => (
        <Handle
          key={port.name}
          id={port.name}
          type="target"
          position={Position.Left}
          style={{ top: handleOffset(i, inputs.length) }}
          className="!size-3 !border-2 !border-background !bg-muted-foreground"
          title={port.displayName ?? port.name}
        />
      ))}
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
        <NodeIcon name={description?.icon} className="size-4" />
      </span>
      <span className="grid min-w-0">
        <span className={cn('truncate text-sm font-medium', node.disabled && 'line-through')}>
          {node.name}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {description?.displayName ?? `Tipo desconhecido: ${node.type}`}
        </span>
      </span>
      {pinned && (
        <span
          data-testid="node-pinned"
          title="Dados fixados: o nó não executa"
          className="absolute -top-2 -left-2 rounded-full bg-primary p-0.5 text-primary-foreground"
        >
          <Pin className="size-3" />
        </span>
      )}
      {run && <RunStatus run={run} />}
      {actions.canExecute && (
        // Executa só este nó, reaproveitando os anteriores (FR-020), como o "Execute step" do N8N.
        <div
          className={cn(
            'nodrag nopan absolute -top-9 left-1/2 -translate-x-1/2 rounded-md border bg-card p-0.5 shadow-sm',
            selected ? 'flex' : 'hidden group-hover:flex',
          )}
        >
          <button
            type="button"
            data-testid="node-run"
            aria-label={`Executar o nó ${node.name}`}
            title="Executar este nó"
            disabled={actions.running}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            onClick={(e) => {
              e.stopPropagation();
              actions.runNode(node.id);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
            }}
          >
            <Play className="size-3.5" />
          </button>
        </div>
      )}
      {hasError && (
        <span
          data-testid="node-error"
          className="absolute -top-2 -right-2 rounded-full bg-destructive p-0.5 text-white"
        >
          <AlertTriangle className="size-3" />
        </span>
      )}
      {outputs.map((port, i) => (
        <Handle
          key={port.name}
          id={port.name}
          type="source"
          position={Position.Right}
          style={{ top: handleOffset(i, outputs.length) }}
          className="!size-3 !border-2 !border-background !bg-primary"
          title={port.displayName ?? port.name}
        >
          {outputs.length > 1 && (
            <span className="pointer-events-none absolute left-3 -translate-y-1/2 text-[10px] text-muted-foreground">
              {port.displayName ?? port.name}
            </span>
          )}
        </Handle>
      ))}
    </div>
  );
});
