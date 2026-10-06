import { agentNode } from './ai/agent/definition.js';
import { chatModelNode } from './ai/chat-model/definition.js';
import { mcpClientNode } from './ai/mcp-client/definition.js';
import { bufferMemoryNode, postgresMemoryNode } from './ai/memory/definitions.js';
import { createAgentToolNodes } from './ai/tools/definitions.js';
import { executeWorkflowNode } from './flow/execute-workflow/definition.js';
import { waitNode } from './flow/wait/definition.js';
import { executeWorkflowTrigger } from './trigger/execute-workflow/definition.js';
import { codeJavascriptNode } from './code/javascript/definition.js';
import { setNode } from './data/set/definition.js';
import { setVariableNode } from './data/set-variable/definition.js';
import { OAuth2TokenCache } from './http/auth.js';
import {
  DEFAULT_HTTP_MAX_RESPONSE_BYTES,
  createHttpRequestNode,
} from './http/request/definition.js';
import { ifNode } from './logic/if/definition.js';
import { loopOverItemsNode } from './logic/loop-over-items/definition.js';
import { mergeNode } from './logic/merge/definition.js';
import { switchNode } from './logic/switch/definition.js';
import { whileNode } from './logic/while/definition.js';
import { ColumnCache } from './postgres/catalog.js';
import { PoolManager } from './postgres/pool.js';
import { createPostgresQueryNode } from './postgres/query/definition.js';
import { createPostgresWriteNode } from './postgres/write/definition.js';
import { NodeRegistry } from './registry.js';
import { createHttpGuard, type HttpGuard } from './shared/http-guard.js';
import { respondToWebhookNode } from './http/respond-to-webhook/definition.js';
import { errorTrigger } from './trigger/error/definition.js';
import { manualTrigger } from './trigger/manual/definition.js';
import { webhookTrigger } from './trigger/webhook/definition.js';
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
  const httpRequest = createHttpRequestNode({
    guard: options.httpGuard ?? createHttpGuard(),
    oauth: options.oauth ?? new OAuth2TokenCache(),
    maxResponseBytes: options.httpMaxResponseBytes ?? DEFAULT_HTTP_MAX_RESPONSE_BYTES,
  });
  const postgresQuery = createPostgresQueryNode({ pools });
  return [
    manualTrigger,
    setNode,
    setVariableNode,
    ifNode,
    httpRequest,
    postgresQuery,
    createPostgresWriteNode({ pools, columns: options.columns ?? new ColumnCache() }),
    webhookTrigger,
    respondToWebhookNode,
    codeJavascriptNode,
    // Spec 007: controle de fluxo e workflow de erro.
    mergeNode,
    whileNode,
    loopOverItemsNode,
    switchNode,
    errorTrigger,
    // Spec 010: cliente MCP (o acesso aos servidores vem do motor, `ctx.mcp()`).
    mcpClientNode,
    // Spec 008 (parte antecipada): espera e sub-workflows.
    waitNode,
    executeWorkflowTrigger,
    executeWorkflowNode,
    // Spec 011: Agent e sub-nós (modelo, memórias, ferramentas).
    agentNode,
    chatModelNode,
    postgresMemoryNode,
    bufferMemoryNode,
    ...createAgentToolNodes({ httpRequest, postgresQuery }),
  ];
}

/** Com os padrões (allowlist vazia, 50 MB, 5 conexões por credencial). */
export const builtinNodes: readonly NodeDefinition[] = createBuiltinNodes();

export function createNodeRegistry(nodes: readonly NodeDefinition[] = builtinNodes): NodeRegistry {
  const registry = new NodeRegistry();
  for (const node of nodes) registry.register(node);
  return registry;
}
