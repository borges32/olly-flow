import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { NodeDescription } from '@olly/nodes';
import { resolveNodePorts, type WorkflowNode } from '@olly/shared-types';
import {
  AlertTriangle,
  Check,
  Hourglass,
  Loader2,
  Minus,
  Pin,
  Play,
  Square,
  X,
} from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { useNodeActions } from './node-actions';
import { NodeIcon } from './node-icon';
import { nodeMinSize } from './node-layout';
import { isSubNodePort } from './subnodes';
import type { NodeRunView } from './store';
import type { DiffStatus } from './version-diff';

export type OllyNodeData = {
  node: WorkflowNode;
  description: NodeDescription | undefined;
  errors: string[];
  /** Estado na última execução de teste (FR-012). */
  run?: NodeRunView;
  pinned: boolean;
  /** Comparação de versões (spec 009, FR-010). */
  diffStatus?: DiffStatus;
};

const DIFF_LABEL: Record<DiffStatus, string> = {
  added: 'novo',
  removed: 'removido',
  changed: 'alterado',
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
    case 'waiting':
      // Spec 008: espera (Wait) ou aprovação humana (spec 011); a execução retoma depois.
      return (
        <span
          data-testid="node-status"
          data-status="waiting"
          className={cn(common, 'text-sky-600 dark:text-sky-400')}
          title={run.error?.message ?? 'Aguardando a retomada'}
        >
          <Hourglass className="size-3" /> aguardando
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
  const { node, description, errors, run, pinned, diffStatus } = data;
  const actions = useNodeActions();
  // Portas efetivas: dinâmicas (Merge, Switch) e de erro (spec 007).
  const ports = description ? resolveNodePorts(description, node) : { inputs: [], outputs: [] };
  // Spec 011, FR-001: portas de sub-nó na vertical (base do Agent; topo do sub-nó), como no N8N.
  const inputs = ports.inputs.filter((p) => !isSubNodePort(p));
  const subInputs = ports.inputs.filter((p) => isSubNodePort(p));
  const outputs = ports.outputs.filter((p) => !isSubNodePort(p));
  const subOutputs = ports.outputs.filter((p) => isSubNodePort(p));
  const isSubNode = ports.outputs.length > 0 && subOutputs.length === ports.outputs.length;
  const hasError = errors.length > 0;
  return (
    <div
      data-testid={`node-${node.name}`}
      data-x={node.position[0]}
      data-y={node.position[1]}
      data-diff={diffStatus}
      data-subnode={isSubNode || undefined}
      title={hasError ? errors.join('\n') : undefined}
      // Portas espaçadas: o nó cresce com o número de entradas, saídas e sub-nós.
      style={nodeMinSize({
        inputs: inputs.length,
        outputs: outputs.length,
        bottom: subInputs.length,
      })}
      className={cn(
        'group relative flex min-w-44 items-center gap-2 border-2 bg-card px-3 py-2 text-card-foreground shadow-sm',
        isSubNode ? 'rounded-full' : 'rounded-lg',
        subInputs.length > 0 && 'pb-5',
        selected ? 'border-primary' : 'border-border',
        hasError && 'border-destructive',
        node.disabled && 'opacity-50',
        run?.status === 'error' && 'border-destructive',
        run?.status === 'running' && 'border-primary ring-2 ring-primary/30',
        diffStatus === 'added' && 'border-emerald-500 ring-2 ring-emerald-500/30',
        diffStatus === 'changed' && 'border-amber-500 ring-2 ring-amber-500/30',
        diffStatus === 'removed' && 'border-dashed border-destructive opacity-60',
      )}
    >
      {diffStatus && (
        <span
          className={cn(
            'absolute -top-2.5 left-2 rounded-full border bg-card px-1.5 text-[10px] font-medium',
            diffStatus === 'added' && 'border-emerald-500 text-emerald-700 dark:text-emerald-400',
            diffStatus === 'changed' && 'border-amber-500 text-amber-700 dark:text-amber-400',
            diffStatus === 'removed' && 'border-destructive text-destructive',
          )}
        >
          {DIFF_LABEL[diffStatus]}
        </span>
      )}
      {inputs.map((port, i) => (
        <Handle
          key={port.name}
          id={port.name}
          type="target"
          position={Position.Left}
          style={{ top: handleOffset(i, inputs.length) }}
          className={cn(
            '!size-3 !border-2 !border-background',
            port.name === 'continue' ? '!bg-amber-500' : '!bg-muted-foreground',
          )}
          title={port.displayName ?? port.name}
        >
          {inputs.length > 1 && (
            <span className="pointer-events-none absolute right-3 -translate-y-1/2 text-[10px] whitespace-nowrap text-muted-foreground">
              {port.displayName ?? port.name}
            </span>
          )}
        </Handle>
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
          className={cn(
            '!size-3 !border-2 !border-background',
            port.name === 'error' ? '!bg-destructive' : '!bg-primary',
          )}
          title={port.displayName ?? port.name}
        >
          {outputs.length > 1 && (
            <span className="pointer-events-none absolute left-3 -translate-y-1/2 text-[10px] text-muted-foreground">
              {port.displayName ?? port.name}
            </span>
          )}
        </Handle>
      ))}
      {subInputs.map((port, i) => (
        <Handle
          key={port.name}
          id={port.name}
          type="target"
          position={Position.Bottom}
          style={{ left: handleOffset(i, subInputs.length) }}
          className="!size-3 !rounded-sm !border-2 !border-background !bg-violet-500"
          title={`${port.displayName ?? port.name}${port.required ? ' (obrigatório)' : ''}`}
          data-testid={`port-${port.name}`}
        >
          <span className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap text-muted-foreground">
            {port.displayName ?? port.name}
            {port.required && <span className="text-destructive">*</span>}
          </span>
        </Handle>
      ))}
      {subOutputs.map((port, i) => (
        <Handle
          key={port.name}
          id={port.name}
          type="source"
          position={Position.Top}
          style={{ left: handleOffset(i, subOutputs.length) }}
          className="!size-3 !rounded-sm !border-2 !border-background !bg-violet-500"
          title={port.displayName ?? port.name}
        />
      ))}
    </div>
  );
});
