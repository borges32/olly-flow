import type { BinaryRef, WorkflowNode } from '@olly/shared-types';
import type { ResolvedCredential } from '../credentials/definitions.js';
import { mapWithConcurrency } from '../shared/concurrency.js';
import type { AiGateway } from '../ai/runtime/types.js';
import type {
  CodeMode,
  LoopState,
  McpGateway,
  NodeContext,
  NodeResume,
  SubWorkflowGateway,
  WebhookResponse,
} from '../types.js';

export interface FakeContext extends NodeContext {
  secrets: string[];
  logs: string[];
  binaries: Map<string, Uint8Array>;
  /** Respostas de webhook pedidas pelo nó (a primeira vale). */
  responses: WebhookResponse[];
}

/**
 * Contexto de nó para testes, sem motor: `getParam` devolve os parâmetros como estão
 * (por item, se for uma lista de objetos de parâmetros).
 */
export function fakeContext(options: {
  params: Record<string, unknown> | Record<string, unknown>[];
  node?: Partial<WorkflowNode>;
  credential?: ResolvedCredential;
  signal?: AbortSignal;
  runCode?: (request: { code: string; mode: CodeMode }) => Promise<unknown>;
  loop?: LoopState;
  /** Gateway MCP de teste (spec 010). */
  mcp?: McpGateway;
  runIndex?: number;
  subWorkflows?: SubWorkflowGateway;
  resume?: NodeResume;
  subNodes?: NodeContext['subNodes'];
  ai?: AiGateway;
}): FakeContext {
  const responses: WebhookResponse[] = [];
  const perItem = Array.isArray(options.params) ? options.params : undefined;
  const base = perItem ? (perItem[0] ?? {}) : (options.params as Record<string, unknown>);
  const secrets: string[] = [];
  const logs: string[] = [];
  const binaries = new Map<string, Uint8Array>();
  const node: WorkflowNode = {
    id: 'n',
    type: 'test.node',
    name: 'Nó',
    params: base,
    position: [0, 0],
    ...(options.credential && { credentialId: options.credential.id }),
    ...options.node,
  };
  const log = (m: string) => {
    logs.push(m);
  };
  return {
    executionId: 'exec',
    workflowId: 'wf',
    node,
    getParam: (name, i) => (perItem ? (perItem[i] ?? base) : base)[name],
    setVariable: () => undefined,
    getCredential: () =>
      options.credential
        ? Promise.resolve(options.credential)
        : Promise.reject(new Error('sem credencial')),
    signal: options.signal ?? new AbortController().signal,
    logger: { debug: log, info: log, warn: log, error: log },
    helpers: {
      pairedItem: (item, itemIndex) => ({ ...item, pairedItem: { item: itemIndex } }),
      getBinary: (ref) => {
        const data = binaries.get(ref.id);
        return data
          ? Promise.resolve(data)
          : Promise.reject(new Error(`binário ${ref.id} ausente`));
      },
      putBinary: (data, meta) => {
        const ref: BinaryRef = { id: `bin-${binaries.size + 1}`, size: data.byteLength, ...meta };
        binaries.set(ref.id, data);
        return Promise.resolve(ref);
      },
      registerSecret: (value) => {
        secrets.push(value);
      },
    },
    runCode: options.runCode ?? (() => Promise.reject(new Error('sem sandbox de código'))),
    respondToWebhook: (response) => {
      responses.push(response);
      return responses.length === 1;
    },
    ...(options.loop && { loop: options.loop }),
    maxLoopIterations: 10_000,
    runIndex: options.runIndex ?? 0,
    mcp: () => {
      if (!options.mcp) throw new Error('sem gateway MCP');
      return options.mcp;
    },
    subWorkflows: () => {
      if (!options.subWorkflows) throw new Error('sem gateway de sub-workflows');
      return options.subWorkflows;
    },
    ...(options.resume && { resume: options.resume }),
    subNodes: options.subNodes ?? (() => Promise.resolve([])),
    withFromAI: (values) =>
      Promise.resolve((name: string) => {
        const raw = base[name];
        // Teste simples: `{{ $fromAI('x') }}` vira o valor de `x`.
        const match = typeof raw === 'string' ? /\$fromAI\(\s*['"]([^'"]+)['"]/.exec(raw) : null;
        return match?.[1] !== undefined ? values[match[1]] : raw;
      }),
    ai: () => {
      if (!options.ai) throw new Error('sem gateway de IA');
      return options.ai;
    },
    // Como o motor, para um tipo com `supportsParallelItems` (spec 006, FR-009).
    mapItems: (items, fn) => {
      const parallel = node.settings?.parallelItems;
      return mapWithConcurrency(items, parallel?.enabled ? parallel.concurrency : 1, fn);
    },
    secrets,
    logs,
    binaries,
    responses,
  };
}
