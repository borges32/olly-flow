import type { NodeContext, NodeDefinition, NodeLogger, NodeRegistry } from '@olly/nodes';
import type { ExpressionEvaluator } from '@olly/expressions';
import type { Item, NodeOutput, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { resolveNodeParams, type ExpressionScope, type ParamResolver } from './expressions.js';
import { fillPairedItems } from './paired.js';
import { ExecutionState, type NodeRunStatus, type SourceRef } from './state.js';
import { findCycles } from './validate.js';

/** Registro do que aconteceu com um nó (para o log de execução e eventos em tempo real). */
export interface NodeRunRecord {
  nodeId: string;
  nodeName: string;
  status: 'success' | 'error' | 'skipped';
  startedAt: Date;
  finishedAt: Date;
  inputs: Record<string, Item[]>;
  inputSources: Record<string, SourceRef[]>;
  output?: NodeOutput;
  error?: { name: string; message: string };
  pinned: boolean;
  itemsIn: number;
  itemsOut: number;
}

export interface RunCallbacks {
  onNodeStart?(nodeId: string, startedAt: Date): void | Promise<void>;
  onNodeSuccess?(nodeId: string, output: NodeOutput): void | Promise<void>;
  onNodeError?(nodeId: string, error: Error): void | Promise<void>;
  /** Para todo nó que terminou: sucesso, erro ou sem dados (`skipped`). */
  onNodeFinish?(record: NodeRunRecord): void | Promise<void>;
  onExecutionFinish?(result: RunResult): void | Promise<void>;
}

export interface RunOptions {
  /** Itens entregues ao gatilho. Sem itens, `trigger.manual` emite um item vazio. */
  triggerItems?: Item[];
  /** Gatilho que inicia a execução. Padrão: o único gatilho do workflow. */
  startNodeId?: string;
  /** Executa só os ancestores deste nó e o próprio nó ("Executar até este nó"). */
  destinationNodeId?: string;
  /** Saídas fixadas por id do nó: o nó emite estes itens e não executa (FR-016). */
  pinData?: Record<string, Item[]>;
  executionId?: string;
  mode?: 'test' | 'production';
  workflowId?: string;
  workflowName?: string;
  /** Avaliador de expressões (task runner). Obrigatório se o workflow tiver expressões. */
  evaluator?: ExpressionEvaluator;
  /** Variáveis visíveis em `$env` (já filtradas: só `OLLY_EXPOSED_*`). */
  env?: Record<string, string>;
  timezone?: string;
  signal?: AbortSignal;
  logger?: NodeLogger;
  callbacks?: RunCallbacks;
}

export interface NodeRunResult {
  status: NodeRunStatus;
  output?: NodeOutput;
  error?: string;
  pinned?: boolean;
}

export interface RunResult {
  status: 'success' | 'error';
  nodes: Record<string, NodeRunResult>;
  /** Variáveis gravadas por `data.setVariable` ao longo da execução. */
  vars: Record<string, unknown>;
  error?: { nodeId: string; message: string };
}

const noopLogger: NodeLogger = { debug() {}, info() {}, warn() {}, error() {} };

export class WorkflowRunError extends Error {
  override name = 'WorkflowRunError';
}

function unavailable(feature: string): never {
  throw new Error(`${feature} ainda não está disponível no motor`);
}

function createContext(
  node: WorkflowNode,
  options: RunOptions,
  getParam: ParamResolver,
  vars: Record<string, unknown>,
): NodeContext {
  return {
    executionId: options.executionId ?? 'local',
    workflowId: options.workflowId ?? 'local',
    node,
    getParam,
    setVariable: (name, value) => {
      vars[name] = structuredClone(value);
    },
    getCredential: () => unavailable('Credenciais'),
    signal: options.signal ?? new AbortController().signal,
    logger: options.logger ?? noopLogger,
    helpers: {
      pairedItem: (item, itemIndex, input) => ({
        ...item,
        pairedItem: input === undefined ? { item: itemIndex } : { item: itemIndex, input },
      }),
      getBinary: () => unavailable('Binários'),
      putBinary: () => unavailable('Binários'),
    },
  };
}

/** Ordem topológica estável (Kahn), desempatando pela ordem dos nós na definição. */
function topologicalOrder(def: WorkflowDefinition): string[] {
  const indegree = new Map(def.nodes.map((n) => [n.id, 0]));
  for (const e of def.edges) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  const queue = def.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const e of def.edges) {
      if (e.from !== id) continue;
      const remaining = (indegree.get(e.to) ?? 0) - 1;
      indegree.set(e.to, remaining);
      if (remaining === 0) queue.push(e.to);
    }
  }
  return order;
}

function walk(start: string, def: WorkflowDefinition, direction: 'down' | 'up'): Set<string> {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const e of def.edges) {
      const [from, to] = direction === 'down' ? [e.from, e.to] : [e.to, e.from];
      if (from === id && !seen.has(to)) {
        seen.add(to);
        stack.push(to);
      }
    }
  }
  return seen;
}

function pickStartNode(
  def: WorkflowDefinition,
  registry: NodeRegistry,
  startNodeId?: string,
): WorkflowNode {
  if (startNodeId) {
    const node = def.nodes.find((n) => n.id === startNodeId);
    if (!node) throw new WorkflowRunError(`Nó inicial inexistente: ${startNodeId}`);
    return node;
  }
  const triggers = def.nodes.filter((n) => registry.get(n.type)?.category === 'trigger');
  const [only] = triggers;
  if (triggers.length !== 1 || !only) {
    throw new WorkflowRunError(
      triggers.length === 0
        ? 'O workflow não tem gatilho'
        : 'Há mais de um gatilho: informe o nó inicial',
    );
  }
  return only;
}

/** Nó desabilitado: repassa a primeira entrada para a primeira saída (FR-016 da spec 002). */
function passThrough(def: NodeDefinition, inputs: Record<string, Item[]>): NodeOutput {
  const firstInput =
    def.inputs.map((p) => inputs[p.name]).find((items) => items !== undefined) ?? [];
  return { [def.outputs[0]?.name ?? 'main']: firstInput };
}

const countItems = (data: Record<string, Item[]> | undefined) =>
  Object.values(data ?? {}).reduce((n, items) => n + items.length, 0);

/**
 * Executa o workflow sequencialmente em ordem topológica, a partir de um gatilho (spec 002,
 * FR-016), resolvendo expressões em lote por nó (spec 003). Ramo sem itens não executa: o nó
 * fica `skipped` e propaga "sem dados". O primeiro erro interrompe a execução.
 */
export async function runWorkflow(
  def: WorkflowDefinition,
  registry: NodeRegistry,
  options: RunOptions = {},
): Promise<RunResult> {
  if (
    findCycles(
      def.nodes.map((n) => n.id),
      def.edges,
    ).length > 0
  ) {
    throw new WorkflowRunError('O workflow contém ciclo');
  }
  const start = pickStartNode(def, registry, options.startNodeId);
  let scope = walk(start.id, def, 'down');
  if (options.destinationNodeId) {
    if (!scope.has(options.destinationNodeId)) {
      throw new WorkflowRunError('O nó de destino não é alcançável a partir do gatilho');
    }
    const ancestors = walk(options.destinationNodeId, def, 'up');
    scope = new Set([...scope].filter((id) => ancestors.has(id)));
  }
  const scoped: WorkflowDefinition = {
    ...def,
    nodes: def.nodes.filter((n) => scope.has(n.id)),
    edges: def.edges.filter((e) => scope.has(e.from) && scope.has(e.to)),
  };
  const state = new ExecutionState(scoped);
  const nodesById = new Map(scoped.nodes.map((n) => [n.id, n]));
  state.get(start.id).inputs = { main: structuredClone(options.triggerItems ?? []) };

  const executionId = options.executionId ?? 'local';
  const vars: Record<string, unknown> = {};
  const expressionScope = (): ExpressionScope => ({
    executionId,
    mode: options.mode ?? 'test',
    workflow: {
      id: options.workflowId ?? 'local',
      name: options.workflowName ?? '',
      active: false,
    },
    vars,
    env: options.env ?? {},
    timezone: options.timezone ?? 'America/Sao_Paulo',
  });
  const cb = options.callbacks ?? {};
  let failure: RunResult['error'];

  try {
    for (const nodeId of topologicalOrder(scoped)) {
      const node = nodesById.get(nodeId);
      const run = state.get(nodeId);
      if (!node || !state.isReady(nodeId)) continue;
      const type = registry.get(node.type);
      if (!type) throw new WorkflowRunError(`Nó "${node.name}": tipo desconhecido "${node.type}"`);

      const startedAt = new Date();
      const record = (
        status: NodeRunRecord['status'],
        extra: Partial<NodeRunRecord> = {},
      ): NodeRunRecord => ({
        nodeId,
        nodeName: node.name,
        status,
        startedAt,
        finishedAt: new Date(),
        inputs: run.inputs,
        inputSources: run.sources,
        pinned: run.pinned === true,
        itemsIn: countItems(run.inputs),
        itemsOut: countItems(run.output),
        ...extra,
      });

      const hasData = Object.values(run.inputs).some((items) => items.length > 0);
      if (nodeId !== start.id && !hasData) {
        run.status = 'skipped';
        run.output = {};
        await cb.onNodeFinish?.(record('skipped'));
        continue;
      }

      run.status = 'running';
      await cb.onNodeStart?.(nodeId, startedAt);
      try {
        options.signal?.throwIfAborted();
        const pinned = options.pinData?.[nodeId];
        let output: NodeOutput;
        if (pinned) {
          run.pinned = true;
          output = { [type.outputs[0]?.name ?? 'main']: structuredClone(pinned) };
        } else if (node.disabled) {
          output = passThrough(type, run.inputs);
        } else {
          const items = run.inputs.main ?? [];
          const getParam = await resolveNodeParams(
            scoped,
            registry,
            state,
            node,
            items,
            expressionScope(),
            options.evaluator,
          );
          output = await type.execute(
            { inputs: run.inputs, items },
            createContext(node, options, getParam, vars),
          );
        }
        output = fillPairedItems(output, countItems(run.inputs));
        run.status = 'success';
        run.output = output;
        state.deliver(nodeId, output);
        await cb.onNodeSuccess?.(nodeId, output);
        await cb.onNodeFinish?.(record('success', { output }));
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        run.status = 'error';
        run.error = error;
        failure = { nodeId, message: error.message };
        await cb.onNodeError?.(nodeId, error);
        await cb.onNodeFinish?.(
          record('error', { error: { name: error.name, message: error.message } }),
        );
        break;
      }
    }
  } finally {
    await options.evaluator?.disposeExecution(executionId).catch(() => undefined);
  }

  const result: RunResult = {
    status: failure ? 'error' : 'success',
    nodes: Object.fromEntries(
      [...state.nodes].map(([id, s]) => [
        id,
        {
          status: s.status,
          ...(s.output && { output: s.output }),
          ...(s.error && { error: s.error.message }),
          ...(s.pinned && { pinned: true }),
        },
      ]),
    ),
    vars,
    ...(failure && { error: failure }),
  };
  await cb.onExecutionFinish?.(result);
  return result;
}
