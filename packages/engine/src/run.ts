import {
  NodeExecutionError,
  errorJson,
  mapWithConcurrency,
  type CodeMode,
  type NodeContext,
  type NodeDefinition,
  type NodeLogger,
  type LoopState,
  type NodeRegistry,
  type ResolvedCredential,
  type WebhookResponse,
} from '@olly/nodes';
import { findCodeReferences, type CodeRunner, type ExpressionEvaluator } from '@olly/expressions';
import {
  ERROR_PORT,
  LOOP_CONTINUE_PORT,
  LOOP_NODE_TYPES,
  analyzeLoops,
  resolveNodePorts,
  type BinaryRef,
  type Item,
  type LoopAnalysis,
  type NodeOutput,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@olly/shared-types';
import {
  buildExpressionData,
  resolveNodeParams,
  type ExpressionScope,
  type ParamResolver,
} from './expressions.js';
import { fillPairedItems } from './paired.js';
import { redactSecrets } from './redact.js';
import { ExecutionState, type NodeRunStatus, type SourceRef } from './state.js';

/** Registro do que aconteceu com um nó (para o log de execução e eventos em tempo real). */
export interface NodeRunRecord {
  nodeId: string;
  nodeName: string;
  /** Execução do nó: 0, ou a iteração dentro de laços (spec 007, FR-009). */
  runIndex: number;
  status: 'success' | 'error' | 'skipped' | 'cancelled';
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
  /** Saída do `console` do nó de código (spec 005, FR-012). */
  console?: string[];
  itemsIn: number;
  itemsOut: number;
}

export interface RunCallbacks {
  onNodeStart?(nodeId: string, startedAt: Date, runIndex: number): void | Promise<void>;
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

/** Motivo do fim antecipado de uma execução (spec 006, FR-005, FR-010, FR-011). */
export type CancelReason = 'cancelled' | 'timeout' | 'worker_lost';

/**
 * Razão do `abort` do sinal da execução: o motor encerra com status `cancelled` e este motivo.
 * Outro motivo qualquer no sinal vale como `cancelled`.
 */
export class ExecutionCancelledError extends Error {
  override name = 'ExecutionCancelledError';
  constructor(
    readonly reason: CancelReason,
    message: string,
  ) {
    super(message);
  }
}

/** Laço que passou do limite de iterações (spec 007, FR-006). */
export class LoopLimitExceededError extends Error {
  override name = 'LoopLimitExceededError';
  constructor(nodeName: string, limit: number) {
    super(`Nó "${nodeName}": limite de ${String(limit)} iterações atingido`);
  }
}

/** Teto global padrão de iterações por laço (`OLLY_MAX_LOOP_ITERATIONS`). */
export const DEFAULT_MAX_LOOP_ITERATIONS = 10_000;

/** Laços estruturados da definição (spec 007, FR-008). */
export function loopAnalysis(def: WorkflowDefinition): LoopAnalysis {
  const typeOf = new Map(def.nodes.map((n) => [n.id, n.type]));
  const names = new Map(def.nodes.map((n) => [n.id, n.name]));
  return analyzeLoops(
    def.nodes.map((n) => n.id),
    def.edges,
    (id) => LOOP_NODE_TYPES.includes(typeOf.get(id) ?? ''),
    (id) => names.get(id) ?? id,
  );
}

/** Portas efetivas do nó (dinâmicas e de erro, spec 007). */
export const portsOf = (type: NodeDefinition, node: WorkflowNode) => resolveNodePorts(type, node);

/** Paralelismo padrão entre nós prontos (`settings.maxParallel`, spec 006). */
export const DEFAULT_MAX_PARALLEL = 8;

/**
 * Padrão de `maxParallel` quando o workflow não define: `OLLY_DEFAULT_MAX_PARALLEL` (ex.: `1`
 * para reproduzir a execução sequencial, como na suíte de regressão do plan §3) ou 8.
 */
export function defaultMaxParallel(): number {
  const raw = Number(process.env.OLLY_DEFAULT_MAX_PARALLEL);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_PARALLEL;
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
  /** Sandbox do nó de código (task runner, spec 005). */
  codeRunner?: CodeRunner;
  /** Recebe a resposta do webhook (nó "Responder ao webhook"); chamado no máximo uma vez. */
  onWebhookResponse?: (response: WebhookResponse) => void;
  signal?: AbortSignal;
  logger?: NodeLogger;
  callbacks?: RunCallbacks;
  /** Teto global de iterações por laço (spec 007, NFR-001). Padrão: 10 000. */
  maxLoopIterations?: number;
}

export interface NodeRunResult {
  status: NodeRunStatus;
  output?: NodeOutput;
  error?: string;
  pinned?: boolean;
  reused?: boolean;
}

export interface RunResult {
  /** `cancelled`: o sinal da execução abortou (cancelamento, timeout global ou worker perdido). */
  status: 'success' | 'error' | 'cancelled';
  nodes: Record<string, NodeRunResult>;
  /**
   * Nós em ordem topológica estável (spec 006): base determinística para "o último nó" (modo de
   * resposta `lastNode`), já que a ordem de conclusão varia com o paralelismo.
   */
  order: string[];
  /** Variáveis gravadas por `data.setVariable` ao longo da execução. */
  vars: Record<string, unknown>;
  error?: { nodeId?: string; message: string; reason?: CancelReason };
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
  runCode: NodeContext['runCode'];
  respondToWebhook: NodeContext['respondToWebhook'];
  loop: LoopState | undefined;
}

/** Concorrência por item do nó (spec 006, FR-009): 1 se o tipo não suporta ou está desligado. */
function itemConcurrency(node: WorkflowNode, type: NodeDefinition): number {
  const parallel = node.settings?.parallelItems;
  return type.supportsParallelItems && parallel?.enabled ? Math.max(1, parallel.concurrency) : 1;
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
  runCode,
  respondToWebhook,
  loop,
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
    runCode,
    respondToWebhook,
    mapItems: (items, fn) => mapWithConcurrency(items, itemConcurrency(node, type), fn, signal),
    ...(loop && { loop }),
    maxLoopIterations: options.maxLoopIterations ?? DEFAULT_MAX_LOOP_ITERATIONS,
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

const cancellation = (signal: AbortSignal) =>
  signal.reason instanceof ExecutionCancelledError
    ? signal.reason
    : new ExecutionCancelledError('cancelled', abortReason(signal).message);

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

/**
 * Ordem topológica estável (Kahn), desempatando pela ordem dos nós na definição. As arestas de
 * retorno dos laços (spec 007) não entram.
 */
function topologicalOrder(def: WorkflowDefinition, backEdges: Set<string>): string[] {
  const edges = def.edges.filter((e) => !backEdges.has(e.id));
  const indegree = new Map(def.nodes.map((n) => [n.id, 0]));
  for (const e of edges) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  const queue = def.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const e of edges) {
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
function passThrough(
  ports: ReturnType<typeof resolveNodePorts>,
  inputs: Record<string, Item[]>,
): NodeOutput {
  const firstInput =
    ports.inputs.map((p) => inputs[p.name]).find((items) => items !== undefined) ?? [];
  return { [ports.outputs[0]?.name ?? 'main']: firstInput };
}

/** Itens que servem de `$json`/`$input` nas expressões do nó. */
const primaryItems = (inputs: Record<string, Item[]>): Item[] =>
  inputs.main ?? inputs[LOOP_CONTINUE_PORT] ?? inputs.input1 ?? Object.values(inputs)[0] ?? [];

const countItems = (data: Record<string, Item[]> | undefined) =>
  Object.values(data ?? {}).reduce((n, items) => n + items.length, 0);

/**
 * Executa o workflow a partir de um gatilho (spec 002, FR-016) como um agendador de DAG
 * concorrente (spec 006, plan §3): todo nó pronto executa, até `settings.maxParallel` ao mesmo
 * tempo (`1` reproduz a execução sequencial). Ramo sem itens não executa: o nó fica `skipped`
 * e propaga "sem dados" (FR-007). A entrada de cada nó segue a ordem das arestas, o que torna o
 * resultado independente da ordem de conclusão (FR-008). No primeiro erro, nenhum nó novo
 * começa; os que estão em andamento terminam. O sinal (`options.signal`) cancela a execução.
 */
export async function runWorkflow(
  def: WorkflowDefinition,
  registry: NodeRegistry,
  options: RunOptions = {},
): Promise<RunResult> {
  const [invalidCycle] = loopAnalysis(def).invalid;
  if (invalidCycle) throw new WorkflowRunError(invalidCycle.reason);
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
  const loops = loopAnalysis(scoped);
  const state = new ExecutionState(scoped, loops);
  const maxLoopIterations = options.maxLoopIterations ?? DEFAULT_MAX_LOOP_ITERATIONS;
  /** Estado de cada laço em andamento, por nó de laço (`$loop`, plan §3). */
  const loopStates = new Map<string, LoopState>();
  const nodesById = new Map(scoped.nodes.map((n) => [n.id, n]));
  state.get(start.id).inputs = { main: structuredClone(options.triggerItems ?? []) };
  for (const node of scoped.nodes) {
    if (!registry.get(node.type)) {
      throw new WorkflowRunError(`Nó "${node.name}": tipo desconhecido "${node.type}"`);
    }
  }

  const executionId = options.executionId ?? 'local';
  const vars: Record<string, unknown> = {};
  const expressionScope = (nodeId: string): ExpressionScope => {
    const loop = state.innermostLoop(nodeId);
    const current = loop ? loopStates.get(loop.header) : undefined;
    return {
      ...baseScope(),
      ...(current && {
        loop: {
          index: current.index,
          maxIterations: current.maxIterations,
          accumulated: current.accumulated,
        },
      }),
    };
  };
  const baseScope = (): ExpressionScope => ({
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
  const secrets = new Set<string>();
  const logger = redactingLogger(options.logger ?? noopLogger, secrets);
  const consoleByNode = new Map<string, string[]>();
  const finish = (record: NodeRunRecord) => {
    const lines = consoleByNode.get(record.nodeId);
    return cb.onNodeFinish?.(
      redactSecrets(lines ? { ...record, console: lines } : record, secrets),
    );
  };
  let responded = false;
  const respondToWebhook = (response: WebhookResponse): boolean => {
    if (responded) return false;
    responded = true;
    options.onWebhookResponse?.(response);
    return true;
  };
  /** Nó de código (spec 005): contexto como o das expressões, com os nós citados no código. */
  const runCodeFor =
    (node: WorkflowNode, items: Item[]) =>
    async ({ code, mode }: { code: string; mode: CodeMode }): Promise<unknown> => {
      if (!options.codeRunner) return unavailable('Nó de código');
      const data = buildExpressionData(
        scoped,
        registry,
        state,
        node,
        items,
        [],
        expressionScope(node.id),
        findCodeReferences(code),
      );
      const result = await options.codeRunner.runCode({ executionId, code, mode, data });
      consoleByNode.set(node.id, result.console);
      if (!result.ok) {
        throw new NodeExecutionError(`Erro no código: ${result.error.message}`, {
          description: `tipo: ${result.error.kind}`,
        });
      }
      return result.result;
    };

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
    const items = primaryItems(inputs);
    const ports = portsOf(type, node);
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
              expressionScope(node.id),
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
              runCode: runCodeFor(node, items),
              respondToWebhook,
              loop: loopStates.get(node.id),
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
        if (onError === 'errorOutput') {
          // Spec 007, FR-013: falha do nó inteiro → todos os itens de entrada vão para `error`.
          logger.warn(`Nó "${node.name}" falhou; itens desviados para a saída de erro`, {
            error: error instanceof Error ? error.message : String(error),
          });
          const errorData = redactSecrets(errorJson(error), secrets);
          const failed = (items.length > 0 ? items : [{ json: {} }]).map((item, i) => ({
            json: { ...item.json, ...errorData },
            pairedItem: { item: i },
          }));
          return { [ports.outputs[0]?.name ?? 'main']: [], [ERROR_PORT]: failed };
        }
        if (onError !== 'continue') throw error;
        logger.warn(`Nó "${node.name}" falhou; seguindo (onError: continue)`, {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          [ports.outputs[0]?.name ?? 'main']: [
            { json: redactSecrets(errorJson(error), secrets), pairedItem: { item: 0 } },
          ],
        };
      }
    }
  };

  const order = topologicalOrder(scoped, loops.backEdges);
  const rank = new Map(order.map((id, i) => [id, i]));
  const maxParallel = Math.max(1, scoped.settings.maxParallel ?? defaultMaxParallel());
  const running = new Map<string, Promise<void>>();
  const failures: { nodeId: string; message: string }[] = [];
  let cancelled: ExecutionCancelledError | undefined;
  const stopped = () =>
    failures.length > 0 || cancelled !== undefined || options.signal?.aborted === true;

  const recorder =
    (
      nodeId: string,
      node: WorkflowNode,
      startedAt: Date,
      attempts: () => number,
      runIndex: number,
    ) =>
    (status: NodeRunRecord['status'], extra: Partial<NodeRunRecord> = {}): NodeRunRecord => {
      const run = state.get(nodeId);
      return {
        nodeId,
        nodeName: node.name,
        runIndex,
        status,
        startedAt,
        finishedAt: new Date(),
        inputs: run.inputs,
        inputSources: run.sources,
        pinned: run.pinned === true,
        reused: run.reused === true,
        attempts: attempts(),
        itemsIn: countItems(run.inputs),
        itemsOut: countItems(run.output),
        ...extra,
      };
    };

  /**
   * Executa um nó já marcado como `running`; nunca rejeita por falha do nó. O nó de laço
   * (spec 007) recebe `main` (início, `$loop.index` 0) ou `continue` (cada volta).
   */
  const runNode = async (
    node: WorkflowNode,
    type: NodeDefinition,
    phase: 'normal' | 'continue' = 'normal',
  ): Promise<void> => {
    const nodeId = node.id;
    const run = state.get(nodeId);
    const startedAt = new Date();
    let attempts = 1;
    const runIndex = state.nextRunIndex(nodeId);
    const record = recorder(nodeId, node, startedAt, () => attempts, runIndex);
    const ports = portsOf(type, node);
    const loop = state.loopOf(nodeId);
    await cb.onNodeStart?.(nodeId, startedAt, runIndex);
    try {
      options.signal?.throwIfAborted();
      if (LOOP_NODE_TYPES.includes(type.type)) {
        if (phase === 'normal') {
          loopStates.set(nodeId, {
            index: 0,
            maxIterations: maxLoopIterations,
            accumulated: [],
            data: {},
          });
        } else {
          const current = loopStates.get(nodeId);
          if (current) {
            current.index++;
            // NFR-001: teto global, além do limite do próprio nó.
            if (current.index > maxLoopIterations) {
              throw new LoopLimitExceededError(node.name, maxLoopIterations);
            }
          }
        }
      }
      const pinned = options.pinData?.[nodeId];
      let output: NodeOutput;
      if (pinned) {
        run.pinned = true;
        output = { [ports.outputs[0]?.name ?? 'main']: structuredClone(pinned) };
      } else if (node.disabled) {
        output = passThrough(ports, run.inputs);
      } else {
        output = await executeWithResilience(node, type, run.inputs, (n) => {
          attempts = n;
        });
      }
      output = fillPairedItems(output, countItems(run.inputs));
      run.status = 'success';
      run.output = output;
      if (loop) {
        // Spec 007: emitir em `loop` abre uma nova volta do corpo; `done` encerra o laço.
        if ((output.loop?.length ?? 0) > 0) {
          state.active.add(nodeId);
          state.openIteration(nodeId);
        } else {
          state.active.delete(nodeId);
        }
      }
      await cb.onNodeSuccess?.(nodeId, output);
      await finish(record('success', { output }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // Mensagens de erro também passam pelo mascaramento (FR-003); a classe é preservada.
      error.message = redactSecrets(error.message, secrets);
      if (error.stack) error.stack = redactSecrets(error.stack, secrets);
      run.error = error;
      const detail = { error: { name: error.name, message: error.message } };
      if (options.signal?.aborted) {
        // Cancelamento, timeout global ou worker perdido (FR-010/FR-011): não é falha do nó.
        run.status = 'cancelled';
        cancelled ??= cancellation(options.signal);
        await finish(record('cancelled', detail));
        return;
      }
      run.status = 'error';
      failures.push({ nodeId, message: error.message });
      await cb.onNodeError?.(nodeId, error);
      await finish(record('error', detail));
    }
  };

  /**
   * Inicia os nós prontos (até `maxParallel` em andamento) e resolve os que não têm dados ou
   * reaproveitam a saída anterior. Repete enquanto houver mudança de estado.
   */
  const schedule = async (): Promise<void> => {
    for (let changed = true; changed;) {
      changed = false;
      for (const nodeId of order) {
        if (stopped()) return;
        const run = state.get(nodeId);
        // Spec 007: o corpo do laço terminou a volta → o nó de laço recebe a `continue`.
        if (state.continueReady(nodeId)) {
          if (running.size >= maxParallel) continue;
          const header = nodesById.get(nodeId) as WorkflowNode;
          state.collect(nodeId, 'continue');
          run.status = 'running';
          running.set(
            nodeId,
            runNode(header, registry.get(header.type) as NodeDefinition, 'continue').finally(() =>
              running.delete(nodeId),
            ),
          );
          continue;
        }
        const readiness =
          nodeId === start.id
            ? run.status === 'pending'
              ? 'ready'
              : 'waiting'
            : state.readiness(nodeId);
        if (readiness === 'waiting') continue;
        const node = nodesById.get(nodeId) as WorkflowNode;
        const type = registry.get(node.type) as NodeDefinition;
        const record = () =>
          recorder(nodeId, node, new Date(), () => 1, state.nextRunIndex(nodeId));

        const reused =
          nodeId !== options.destinationNodeId &&
          !options.pinData?.[nodeId] &&
          !type.rerunOnPartialExecution &&
          !state.inLoop(nodeId)
            ? options.runData?.[nodeId]
            : undefined;
        if (reused) {
          // Como se tivesse executado agora: os filhos e `$('Nó')` enxergam os dados anteriores.
          run.inputs = structuredClone(reused.inputs);
          run.sources = structuredClone(reused.inputSources);
          run.output = structuredClone(reused.output);
          run.status = 'success';
          run.reused = true;
          await finish(record()('success', { output: run.output }));
          changed = true;
          continue;
        }

        if (readiness === 'noData') {
          state.collect(nodeId);
          run.status = 'skipped';
          run.output = {};
          await finish(record()('skipped'));
          changed = true;
          continue;
        }

        if (running.size >= maxParallel) continue;
        if (nodeId !== start.id) state.collect(nodeId);
        run.status = 'running';
        running.set(
          nodeId,
          runNode(node, type).finally(() => running.delete(nodeId)),
        );
      }
    }
  };

  try {
    for (;;) {
      await schedule();
      if (running.size === 0) break;
      await Promise.race(running.values());
    }
  } catch (error) {
    // Falha de infraestrutura (ex.: callback de gravação): espera os nós em andamento.
    await Promise.allSettled(running.values());
    throw error;
  } finally {
    await options.evaluator?.disposeExecution(executionId).catch(() => undefined);
  }
  if (options.signal?.aborted) cancelled ??= cancellation(options.signal);
  // Vários ramos com erro: vale o primeiro na ordem topológica, não o primeiro a terminar.
  const [failure] = failures.sort((x, y) => (rank.get(x.nodeId) ?? 0) - (rank.get(y.nodeId) ?? 0));

  const result: RunResult = {
    status: cancelled ? 'cancelled' : failure ? 'error' : 'success',
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
    order,
    vars,
    ...(cancelled
      ? { error: { message: cancelled.message, reason: cancelled.reason } }
      : failure && { error: failure }),
  };
  await cb.onExecutionFinish?.(result);
  return result;
}
