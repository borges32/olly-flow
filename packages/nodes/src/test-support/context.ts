import type { BinaryRef, WorkflowNode } from '@olly/shared-types';
import type { ResolvedCredential } from '../credentials/definitions.js';
import type { NodeContext } from '../types.js';

export interface FakeContext extends NodeContext {
  secrets: string[];
  logs: string[];
  binaries: Map<string, Uint8Array>;
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
}): FakeContext {
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
    secrets,
    logs,
    binaries,
  };
}
