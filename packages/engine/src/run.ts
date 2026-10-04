import {
  errorJson,
  type NodeContext,
  type NodeDefinition,
  type NodeLogger,
  type NodeRegistry,
  type ResolvedCredential,
} from '@olly/nodes';
import type { ExpressionEvaluator } from '@olly/expressions';
import type {
  BinaryRef,
  Item,
  NodeOutput,
  WorkflowDefinition,
  WorkflowNode,
} from '@olly/shared-types';
import { resolveNodeParams, type ExpressionScope, type ParamResolver } from './expressions.js';
import { fillPairedItems } from './paired.js';
import { redactSecrets } from './redact.js';
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
  /** Saída reaproveitada de uma execução anterior: o nó não executou (FR-020). */
  reused: boolean;
  /** Tentativas feitas (spec 004, FR-017): 1 sem retry. */
  attempts: number;
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

/** Dados de um nó numa execução anterior, para reaproveitar (spec 003, FR-020). */
export interface ReusedNodeRun {
  inputs: Record<string, Item[]>;
  inputSources: Record<string, SourceRef[]>;
  output: NodeOutput;
}

/** Credencial do nó e os valores que não podem aparecer em dados gravados (spec 004). */
export interface CredentialAccess {
  credential: ResolvedCredential;
  secrets: string[];
}

/** Resolve a credencial de um nó (`node.credentialId`), verificando o projeto (API). */
export type CredentialResolver = (node: WorkflowNode) => Promise<CredentialAccess>;

/** Armazenamento de binários (object storage), fornecido pela API (spec 004, FR-010). */
export interface BinaryStore {
  put(data: Uint8Array, meta: Omit<BinaryRef, 'id' | 'size'>): Promise<BinaryRef>;
  get(ref: BinaryRef): Promise<Uint8Array>;
}

export class NodeTimeoutError extends Error {
  override name = 'NodeTimeoutError';
  constructor(readonly timeoutMs: number) {
    super(`Tempo limite do nó excedido (${timeoutMs} ms)`);
  }
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
  /**
   * Execução de um nó (FR-020): estes nós não executam; entrada, origem dos itens e saída vêm
   * de uma execução anterior. Não vale para o nó de destino, nós fixados e tipos com
   * `rerunOnPartialExecution`.
   */
  runData?: Record<string, ReusedNodeRun>;
  executionId?: string;
  mode?: 'test' | 'production';
  workflowId?: string;
  workflowName?: string;
  /** Avaliador de expressões (task runner). Obrigatório se o workflow tiver expressões. */
  evaluator?: ExpressionEvaluator;
  /** Variáveis visíveis em `$env` (já filtradas: só `OLLY_EXPOSED_*`). */
  env?: Record<string, string>;
  timezone?: string;
  credentials?: CredentialResolver;
  binary?: BinaryStore;
  signal?: AbortSignal;
  logger?: NodeLogger;
  callbacks?: RunCallbacks;
}

export interface NodeRunResult {
  status: NodeRunStatus;
  output?: NodeOutput;
  error?: string;
  pinned?: boolean;
  reused?: boolean;
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

interface ContextDeps {
  node: WorkflowNode;
  type: NodeDefinition;
  options: RunOptions;
  getParam: ParamResolver;
  vars: Record<string, unknown>;
  secrets: Set<string>;
  signal: AbortSignal;
  logger: NodeLogger;
}

function createContext({
  node,
  type,
  options,
  getParam,
  vars,
  secrets,
  signal,
  logger,
}: ContextDeps): NodeContext {
  const binary = () => options.binary ?? unavailable('Armazenamento de binários');
  return {
    executionId: options.executionId ?? 'local',
    workflowId: options.workflowId ?? 'local',
    node,
    getParam,
    setVariable: (name, value) => {
      vars[name] = structuredClone(value);
    },
    getCredential: async () => {
      if (!node.credentialId) throw new Error(`Nó "${node.name}": selecione uma credencial`);
      if (!options.credentials) return unavailable('Credenciais');
      const access = await options.credentials(node);
      for (const secret of access.secrets) secrets.add(secret);
      const allowed = type.credentialTypes;
      if (allowed && !allowed.includes(access.credential.type)) {
        throw new Error(
          `Nó "${node.name}": credencial do tipo ${access.credential.type} não serve para este nó`,
        );
      }
      return access.credential;
    },
    signal,
    logger,
    helpers: {
      pairedItem: (item, itemIndex, input) => ({
        ...item,
        pairedItem: input === undefined ? { item: itemIndex } : { item: itemIndex, input },
      }),
      getBinary: (ref) => binary().get(ref),
      putBinary: (data, meta) => binary().put(data, meta),
      registerSecret: (value) => {
        secrets.add(value);
      },
    },
  };
}

/** Logger que mascara os segredos conhecidos antes de registrar (FR-003). */
function redactingLogger(logger: NodeLogger, secrets: Set<string>): NodeLogger {
  const wrap =
    (fn: NodeLogger['info']): NodeLogger['info'] =>
    (message, data) => {
      fn(redactSecrets(message, secrets), data && redactSecrets(data, secrets));
    };
  return {
    debug: wrap(logger.debug.bind(logger)),
    info: wrap(logger.info.bind(logger)),
    warn: wrap(logger.warn.bind(logger)),
    error: wrap(logger.error.bind(logger)),
  };
}

const abortReason = (signal: AbortSignal) =>
  signal.reason instanceof Error ? signal.reason : new Error('Execução cancelada');

/** Rejeita quando o sinal aborta: o timeout vale mesmo para nó que ignora o sinal (FR-018). */
function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(abortReason(signal));
    else
      signal.addEventListener('abort', () => {
        reject(abortReason(signal));
      });
  });
}

/** Uma tentativa com sinal próprio: aborta no timeout do nó ou no cancelamento da execução. */
async function runAttempt<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number | undefined,
  parent: AbortSignal | undefined,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => {
    controller.abort(parent?.reason);
  };
  parent?.addEventListener('abort', onParentAbort);
  const timer =
    timeoutMs && timeoutMs > 0
      ? setTimeout(() => {
          controller.abort(new NodeTimeoutError(timeoutMs));
        }, timeoutMs)
      : undefined;
  try {
    parent?.throwIfAborted();
    return await Promise.race([fn(controller.signal), rejectOnAbort(controller.signal)]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
    // Libera operações que ainda escutam o sinal (ex.: requisição pendurada após o timeout).
    if (!controller.signal.aborted) controller.abort(new Error('Tentativa encerrada'));
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal ? abortReason(signal) : new Error('Execução cancelada'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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
  const secrets = new Set<string>();
  const logger = redactingLogger(options.logger ?? noopLogger, secrets);
  const finish = (record: NodeRunRecord) => cb.onNodeFinish?.(redactSecrets(record, secrets));

  /**
   * Resolve as expressões e executa o nó com retry, timeout e `onError` (spec 004, FR-017,
   * FR-018, plan §8). Com `onError: continue`, a falha vira um item `{ json: { error } }`.
   */
  const executeWithResilience = async (
    node: WorkflowNode,
    type: NodeDefinition,
    inputs: Record<string, Item[]>,
    onAttempt: (attempt: number) => void,
  ): Promise<NodeOutput> => {
    const { retry, timeoutMs, onError } = node.settings ?? {};
    const maxTries = Math.max(1, retry?.maxTries ?? 1);
    const items = inputs.main ?? [];
    for (let attempt = 1; ; attempt++) {
      onAttempt(attempt);
      try {
        return await runAttempt(
          async (signal) => {
            const getParam = await resolveNodeParams(
              scoped,
              registry,
              state,
              node,
              items,
              expressionScope(),
              options.evaluator,
            );
            const ctx = createContext({
              node,
              type,
              options,
              getParam,
              vars,
              secrets,
              signal,
              logger,
            });
            return type.execute({ inputs, items }, ctx);
          },
          timeoutMs,
          options.signal,
        );
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (attempt < maxTries) {
          const wait = retry?.waitMs ?? 0;
          await sleep(
            retry?.backoff === 'exponential' ? wait * 2 ** (attempt - 1) : wait,
            options.signal,
          );
          continue;
        }
        if (onError !== 'continue') throw error;
        logger.warn(`Nó "${node.name}" falhou; seguindo (onError: continue)`, {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          [type.outputs[0]?.name ?? 'main']: [
            { json: redactSecrets(errorJson(error), secrets), pairedItem: { item: 0 } },
          ],
        };
      }
    }
  };

  try {
    for (const nodeId of topologicalOrder(scoped)) {
      const node = nodesById.get(nodeId);
      const run = state.get(nodeId);
      if (!node || !state.isReady(nodeId)) continue;
      const type = registry.get(node.type);
      if (!type) throw new WorkflowRunError(`Nó "${node.name}": tipo desconhecido "${node.type}"`);

      const startedAt = new Date();
      let attempts = 1;
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
        reused: run.reused === true,
        attempts,
        itemsIn: countItems(run.inputs),
        itemsOut: countItems(run.output),
        ...extra,
      });

      const reused =
        nodeId !== options.destinationNodeId &&
        !options.pinData?.[nodeId] &&
        !type.rerunOnPartialExecution
          ? options.runData?.[nodeId]
          : undefined;
      if (reused) {
        // Como se tivesse executado agora: os filhos e `$('Nó')` enxergam os dados anteriores.
        run.inputs = structuredClone(reused.inputs);
        run.sources = structuredClone(reused.inputSources);
        run.output = structuredClone(reused.output);
        run.status = 'success';
        run.reused = true;
        state.deliver(nodeId, run.output);
        await finish(record('success', { output: run.output }));
        continue;
      }

      const hasData = Object.values(run.inputs).some((items) => items.length > 0);
      if (nodeId !== start.id && !hasData) {
        run.status = 'skipped';
        run.output = {};
        await finish(record('skipped'));
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
          output = await executeWithResilience(node, type, run.inputs, (n) => {
            attempts = n;
          });
        }
        output = fillPairedItems(output, countItems(run.inputs));
        run.status = 'success';
        run.output = output;
        state.deliver(nodeId, output);
        await cb.onNodeSuccess?.(nodeId, output);
        await finish(record('success', { output }));
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        // Mensagens de erro também passam pelo mascaramento (FR-003); a classe é preservada.
        error.message = redactSecrets(error.message, secrets);
        if (error.stack) error.stack = redactSecrets(error.stack, secrets);
        run.status = 'error';
        run.error = error;
        failure = { nodeId, message: error.message };
        await cb.onNodeError?.(nodeId, error);
        await finish(record('error', { error: { name: error.name, message: error.message } }));
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
          ...(s.error && { error: redactSecrets(s.error.message, secrets) }),
          ...(s.pinned && { pinned: true }),
          ...(s.reused && { reused: true }),
        },
      ]),
    ),
    vars,
    ...(failure && { error: failure }),
  };
  await cb.onExecutionFinish?.(result);
  return result;
}
