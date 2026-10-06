// Spec 010: cliente MCP governado (catálogo, políticas, snapshot e registro de chamadas).

/** Somente transportes HTTP nesta versão (FR-004, FR-005: o stdio é recusado). */
export const MCP_TRANSPORTS = ['streamableHttp', 'sse'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export const MCP_SERVER_STATUSES = ['pending', 'active', 'disabled'] as const;
export type McpServerStatus = (typeof MCP_SERVER_STATUSES)[number];

/** Operações do nó `ai.mcpClient` (FR-008). */
export const MCP_OPERATIONS = [
  'callTool',
  'listTools',
  'readResource',
  'listResources',
  'getPrompt',
  'listPrompts',
] as const;
export type McpOperation = (typeof MCP_OPERATIONS)[number];

/** Tipos de credencial dos servidores MCP (FR-007). */
export const MCP_CREDENTIAL_TYPES = ['mcpBearer', 'mcpHeaders', 'mcpOAuth'] as const;

/** Definição de uma tool como o servidor a anuncia (o essencial para o snapshot). */
export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /** Anotações do servidor (fora do hash do snapshot). Spec 011: `readOnlyHint`. */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

/** Tool aprovada no snapshot (FR-003): `hash` de nome, descrição e schema canônicos. */
export interface McpSnapshotTool {
  description?: string;
  inputSchema: Record<string, unknown>;
  hash: string;
}
export type McpToolsSnapshot = Record<string, McpSnapshotTool>;

export type McpToolChangeKind = 'added' | 'changed' | 'removed';

/** Uma diferença entre o snapshot aprovado e o que o servidor anuncia agora. */
export interface McpToolChange {
  name: string;
  kind: McpToolChangeKind;
  before?: Omit<McpSnapshotTool, 'hash'>;
  after?: Omit<McpSnapshotTool, 'hash'>;
}

/** Divergência pendente de revisão (FR-003). */
export interface McpSnapshotDiff {
  detectedAt: string;
  changes: McpToolChange[];
}

/** Capacidades e versão do servidor (`initialize`). */
export interface McpServerInfo {
  name?: string;
  version?: string;
  protocolVersion?: string;
  capabilities: Record<string, unknown>;
  instructions?: string;
}

/** Servidor do catálogo (FR-001). */
export interface McpServer {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  url: string;
  credentialId: string | null;
  /** `null`: servidor global (todos os projetos). */
  projectId: string | null;
  status: McpServerStatus;
  serverInfo: McpServerInfo | null;
  /** Há divergência das tools liberadas aguardando revisão (FR-003). */
  pendingDiff: McpSnapshotDiff | null;
  toolCount: number;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `POST /mcp-servers` e `PUT /mcp-servers/:id`. */
export interface McpServerInput {
  name: string;
  description?: string;
  transport: McpTransport;
  url: string;
  credentialId?: string | null;
  projectId?: string | null;
}

/** `POST /mcp-servers/:id/test`. */
export interface McpServerTestResponse {
  ok: boolean;
  serverInfo?: McpServerInfo;
  tools?: McpToolDefinition[];
  message?: string;
}

/** Política efetiva de uma tool num escopo (FR-002). */
export interface McpToolPolicyView {
  allowed: boolean;
  destructive: boolean;
  /** De onde vem a política: do projeto, global ou nenhuma (negado por padrão). */
  source: 'project' | 'global' | 'default';
}

/** `GET /mcp-servers/:id/tools?projectId=`. */
export interface McpToolView {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  policy: McpToolPolicyView;
  /** A tool tem mudança pendente de revisão (bloqueada se liberada). */
  changed: boolean;
}

/** Item de `PUT /mcp-servers/:id/policies`. */
export interface McpToolPolicyInput {
  toolName: string;
  allowed: boolean;
  destructive: boolean;
}

/** `PUT /mcp-servers/:id/policies`. `projectId` ausente/nulo = política global. */
export interface McpPoliciesRequest {
  projectId?: string | null;
  policies: McpToolPolicyInput[];
}

/** Servidor disponível para uso num projeto (`GET /projects/:id/mcp-servers`). */
export interface McpServerOption {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  /** Tools liberadas no projeto, com o schema do snapshot (formulário do nó, FR-009). */
  tools: McpToolDefinition[];
}

export const MCP_CALL_STATUSES = ['success', 'error', 'denied', 'blocked'] as const;
export type McpCallStatus = (typeof MCP_CALL_STATUSES)[number];

/** Chamada registrada (FR-011). Os argumentos já vêm mascarados. */
export interface McpCall {
  id: string;
  executionId: string;
  nodeId: string;
  runIndex: number;
  itemIndex: number;
  serverId: string | null;
  serverName: string;
  operation: McpOperation;
  target: string | null;
  /** `undefined` quando o usuário não tem `execution:readData`. */
  arguments?: unknown;
  status: McpCallStatus;
  durationMs: number;
  resultBytes: number | null;
  error: string | null;
  createdAt: string;
}

/** Estado da conexão OAuth de uma credencial `mcpOAuth` (sem segredos). */
export interface McpOAuthStatus {
  connected: boolean;
  expiresAt: string | null;
  scope: string | null;
}

/** `POST /credentials/:id/oauth/authorize`. */
export interface McpOAuthAuthorizeResponse {
  authorizationUrl: string;
}
