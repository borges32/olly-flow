export * from './types.js';
export * from './registry.js';
export * from './builtin.js';
export * from './errors.js';
export { manualTrigger } from './trigger/manual/definition.js';
export { setNode, SET_FIELD_TYPES, type SetFieldType } from './data/set/definition.js';
export { setVariableNode } from './data/set-variable/definition.js';
export { ifNode } from './logic/if/definition.js';
export { CONDITION_TYPES, OPERATIONS, type ConditionType } from './logic/if/operators.js';
export * from './credentials/definitions.js';
export * from './credentials/registry.js';
export * from './credentials/test.js';
export * from './shared/http-guard.js';
export { mapWithConcurrency } from './shared/concurrency.js';
export { OAuth2TokenCache, applyHttpCredential } from './http/auth.js';
export {
  createHttpRequestNode,
  DEFAULT_HTTP_MAX_RESPONSE_BYTES,
  DEFAULT_HTTP_TIMEOUT_MS,
} from './http/request/definition.js';
export { PoolManager, DEFAULT_PG_POOL_MAX, connectionConfig } from './postgres/pool.js';
export {
  ColumnCache,
  listSchemas,
  listTables,
  listColumns,
  type ColumnInfo,
} from './postgres/catalog.js';
export { createPostgresQueryNode } from './postgres/query/definition.js';
export { createPostgresWriteNode } from './postgres/write/definition.js';
export { codeJavascriptNode, DEFAULT_CODE } from './code/javascript/definition.js';
export { normalizeItems } from './code/javascript/normalize.js';
export {
  webhookTrigger,
  WEBHOOK_AUTH_CREDENTIAL,
  WEBHOOK_METHODS,
  WEBHOOK_RESPONSE_MODES,
} from './trigger/webhook/definition.js';
export { verifyWebhookAuth, hmacSignature, safeEqual } from './trigger/webhook/auth.js';
export { respondToWebhookNode } from './http/respond-to-webhook/definition.js';
export { mergeNode } from './logic/merge/definition.js';
export { combineJson } from './logic/merge/execute.js';
export { whileNode, WHILE_DEFAULT_MAX_ITERATIONS } from './logic/while/definition.js';
export { loopOverItemsNode } from './logic/loop-over-items/definition.js';
export { switchNode } from './logic/switch/definition.js';
export { errorTrigger, SAMPLE_ERROR_PAYLOAD } from './trigger/error/definition.js';
export { mcpClientNode, mcpClientParamsSchema } from './ai/mcp-client/definition.js';
export { waitNode, waitDuration, INLINE_WAIT_MS } from './flow/wait/definition.js';
export { executeWorkflowNode } from './flow/execute-workflow/definition.js';
export { executeWorkflowTrigger, parseInputSchema } from './trigger/execute-workflow/definition.js';
export * from './ai/runtime/types.js';
export * from './ai/runtime/tool-name.js';
export { agentNode, DEFAULT_AGENT_ITERATIONS } from './ai/agent/definition.js';
export { chatModelNode } from './ai/chat-model/definition.js';
export { postgresMemoryNode, bufferMemoryNode } from './ai/memory/definitions.js';
export { createAgentToolNodes } from './ai/tools/definitions.js';
export * from './ai/runtime/agent.js';
export * from './ai/runtime/from-ai.js';
export * from './ai/runtime/untrusted.js';
export { FakeScriptedChatModel, type FakeModelStep } from './ai/runtime/fake-model.js';
export {
  createChatModel,
  PROVIDER_BY_CREDENTIAL,
  GEMINI_OPENAI_BASE_URL,
} from './ai/runtime/models.js';
export { placeholderNode, PLACEHOLDER_NODE_TYPE } from './flow/placeholder/definition.js';
export {
  createBridgeChatModelNode,
  BRIDGE_CHAT_MODEL_TYPE,
  BRIDGE_DEFAULT_TIMEOUT_MS,
} from './ai/bridge/definition.js';
export {
  BridgeTokenManager,
  bridgeLogin,
  jwtExpiration,
  BRIDGE_DEFAULT_TOKEN_TTL_MS,
} from './ai/bridge/token-manager.js';
export { createBridgeFetch } from './ai/bridge/bridge-fetch.js';
export {
  createAgentixNode,
  extractMessages as extractAgentixMessages,
  AGENTIX_NODE_TYPE,
  AGENTIX_FAILURE_STATES,
} from './ai/agentix/definition.js';
// Spec 016, NFR-003: serviços simulados para os testes (como o modelo simulado da spec 011).
export * from './ai/testing/service-mocks.js';
