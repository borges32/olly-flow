import { setNode } from './data/set/definition.js';
import { setVariableNode } from './data/set-variable/definition.js';
import { OAuth2TokenCache } from './http/auth.js';
import {
  DEFAULT_HTTP_MAX_RESPONSE_BYTES,
  createHttpRequestNode,
} from './http/request/definition.js';
import { ifNode } from './logic/if/definition.js';
import { ColumnCache } from './postgres/catalog.js';
import { PoolManager } from './postgres/pool.js';
import { createPostgresQueryNode } from './postgres/query/definition.js';
import { createPostgresWriteNode } from './postgres/write/definition.js';
import { NodeRegistry } from './registry.js';
import { createHttpGuard, type HttpGuard } from './shared/http-guard.js';
import { manualTrigger } from './trigger/manual/definition.js';
import type { NodeDefinition } from './types.js';

/** Dependências dos nós de integração (spec 004, plan §10): a API passa as da sua configuração. */
export interface BuiltinNodeOptions {
  httpGuard?: HttpGuard;
  httpMaxResponseBytes?: number;
  oauth?: OAuth2TokenCache;
  pools?: PoolManager;
  columns?: ColumnCache;
}

/**
 * Nós da plataforma. Cada spec que cria um nó (src/<categoria>/<nome>/definition.ts)
 * o acrescenta aqui; o teste do registro valida todos.
 */
export function createBuiltinNodes(options: BuiltinNodeOptions = {}): NodeDefinition[] {
  const pools = options.pools ?? new PoolManager();
  return [
    manualTrigger,
    setNode,
    setVariableNode,
    ifNode,
    createHttpRequestNode({
      guard: options.httpGuard ?? createHttpGuard(),
      oauth: options.oauth ?? new OAuth2TokenCache(),
      maxResponseBytes: options.httpMaxResponseBytes ?? DEFAULT_HTTP_MAX_RESPONSE_BYTES,
    }),
    createPostgresQueryNode({ pools }),
    createPostgresWriteNode({ pools, columns: options.columns ?? new ColumnCache() }),
  ];
}

/** Com os padrões (allowlist vazia, 50 MB, 5 conexões por credencial). */
export const builtinNodes: readonly NodeDefinition[] = createBuiltinNodes();

export function createNodeRegistry(nodes: readonly NodeDefinition[] = builtinNodes): NodeRegistry {
  const registry = new NodeRegistry();
  for (const node of nodes) registry.register(node);
  return registry;
}
