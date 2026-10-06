import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

// Tipos espelham infra/migrations. Ao alterar uma tabela, atualize os dois.

type Timestamp = ColumnType<Date, Date | string, Date | string>;
/** Coluna com DEFAULT: opcional no insert. `GeneratedTimestamp` aninharia ColumnType. */
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UsersTable {
  id: Generated<string>;
  external_id: string | null;
  email: string;
  name: string | null;
  is_active: Generated<boolean>;
  created_at: GeneratedTimestamp;
  updated_at: Timestamp | null;
  /** Último login (spec 009, FR-006): base da inativação por falta de uso. */
  last_login_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface RolesTable {
  id: Generated<number>;
  name: string;
  permissions: string[];
}

export interface ProjectsTable {
  id: Generated<string>;
  name: string;
  created_at: GeneratedTimestamp;
  /** Cota de execuções simultâneas (spec 006, FR-012); `null` usa o padrão da configuração. */
  max_concurrent_executions: ColumnType<number | null, number | null | undefined, number | null>;
  /** Spec 009: governança do projeto (FR-011, FR-012, FR-017, FR-019). */
  require_publish_approval: Generated<boolean>;
  executor_can_read_data: Generated<boolean>;
  save_execution_data: ColumnType<
    SaveExecutionData,
    SaveExecutionData | undefined,
    SaveExecutionData
  >;
  /** JSONB `{ dataDays?, metadataDays? }`: insira com `JSON.stringify`. */
  retention: ColumnType<unknown, string | undefined, string>;
}

export type SaveExecutionData = 'all' | 'errorsOnly' | 'none';

export interface ProjectMembersTable {
  project_id: string;
  user_id: string;
  role_id: number;
  created_at: GeneratedTimestamp;
  /** `idp`: herdado de um grupo do IdP (spec 009, FR-005), sincronizado no login. */
  origin: ColumnType<'manual' | 'idp', 'manual' | 'idp' | undefined, 'manual' | 'idp'>;
}

/** Grupo do IdP → papel (spec 009, FR-005); `project_id` nulo = global. */
export interface GroupRoleMappingsTable {
  id: Generated<string>;
  idp_group: string;
  project_id: string | null;
  role_id: number;
  created_by: string | null;
  created_at: GeneratedTimestamp;
}

/** Pedido de publicação (spec 009, FR-011). */
export interface PublishRequestsTable {
  id: Generated<string>;
  workflow_id: string;
  project_id: string;
  version: number;
  message: string;
  requested_by: string;
  status: ColumnType<PublishRequestStatus, PublishRequestStatus | undefined, PublishRequestStatus>;
  decided_by: string | null;
  comment: string | null;
  created_at: GeneratedTimestamp;
  decided_at: Timestamp | null;
}

export type PublishRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** Regra de mascaramento (spec 009, FR-014, FR-016). */
export interface MaskingRulesTable {
  id: Generated<string>;
  scope: 'global' | 'project';
  project_id: string | null;
  kind: 'field' | 'pattern';
  matcher: string;
  action: 'redact' | 'partial' | 'hash';
  enabled: Generated<boolean>;
  builtin: Generated<boolean>;
  description: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

/** Servidor MCP do catálogo (spec 010, FR-001). `project_id` NULL = global. */
export interface McpServersTable {
  id: Generated<string>;
  name: string;
  description: Generated<string>;
  transport: 'streamableHttp' | 'sse';
  url: string;
  credential_id: string | null;
  project_id: string | null;
  status: ColumnType<McpServerStatus, McpServerStatus | undefined, McpServerStatus>;
  /** JSONB `{ [tool]: { description, inputSchema, hash } }` (FR-003): insira com `JSON.stringify`. */
  tools_snapshot: ColumnType<unknown, string | null | undefined, string | null>;
  /** JSONB: divergência detectada aguardando revisão. */
  snapshot_pending_diff: ColumnType<unknown, string | null | undefined, string | null>;
  /** JSONB: capacidades e versão do servidor. */
  server_info: ColumnType<unknown, string | null | undefined, string | null>;
  created_by: string | null;
  approved_by: string | null;
  approved_at: Timestamp | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export type McpServerStatus = 'pending' | 'active' | 'disabled';

/** Política de tool (spec 010, FR-002): sem registro = negado. */
export interface McpToolPoliciesTable {
  id: Generated<string>;
  server_id: string;
  project_id: string | null;
  tool_name: string;
  allowed: Generated<boolean>;
  destructive: Generated<boolean>;
  updated_by: string | null;
  updated_at: GeneratedTimestamp;
}

/** Registro de chamada MCP (spec 010, FR-011). */
export interface McpCallsTable {
  id: Generated<string>;
  execution_id: string;
  project_id: string;
  node_id: string;
  run_index: Generated<number>;
  item_index: Generated<number>;
  server_id: string | null;
  server_name: string;
  operation: string;
  target: string | null;
  /** JSONB mascarado: insira com `JSON.stringify`. */
  arguments: ColumnType<unknown, string | null | undefined, string | null>;
  status: 'success' | 'error' | 'denied' | 'blocked';
  duration_ms: Generated<number>;
  result_bytes: number | null;
  error: string | null;
  created_at: GeneratedTimestamp;
}

export interface AuditLogTable {
  /** BIGSERIAL: o driver `pg` devolve como string. */
  id: Generated<string>;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  /** JSONB: insira com `JSON.stringify`. */
  details: ColumnType<unknown, string | null | undefined, never>;
  ip: string | null;
  created_at: GeneratedTimestamp;
}

export interface WorkflowsTable {
  id: Generated<string>;
  project_id: string;
  name: string;
  version: Generated<number>;
  /** Versão em produção (spec 005); `null` = nunca publicado. */
  published_version: number | null;
  active: Generated<boolean>;
  /** Workflow de erro (spec 007, FR-014), espelho de `settings.errorWorkflowId`. */
  error_workflow_id: ColumnType<string | null, string | null | undefined, string | null>;
  deleted_at: Timestamp | null;
  created_by: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface WorkflowVersionsTable {
  workflow_id: string;
  version: number;
  /** JSONB: insira com `JSON.stringify`. */
  definition: ColumnType<unknown, string, never>;
  message: string | null;
  created_by: string | null;
  created_at: GeneratedTimestamp;
}

export interface WebhooksTable {
  id: Generated<string>;
  workflow_id: string;
  node_id: string;
  method: string;
  path: string;
  active: Generated<boolean>;
  created_at: GeneratedTimestamp;
}

export interface ExecutionsTable {
  id: Generated<string>;
  workflow_id: string;
  project_id: string;
  workflow_version: number | null;
  mode: 'test' | 'production';
  trigger_type: string;
  triggered_by: string | null;
  status: string;
  started_at: GeneratedTimestamp;
  finished_at: Timestamp | null;
  /** JSONB: insira com `JSON.stringify`. */
  error: ColumnType<unknown, string | null | undefined, string | null>;
  /** Definição executada (spec 005): execuções de teste rodam o rascunho não salvo. */
  definition: ColumnType<unknown, string | null | undefined, string | null>;
  /** Último batimento do worker (spec 006, FR-005). */
  heartbeat_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

/** Dados do disparo de uma execução enfileirada (spec 006, FR-001). */
export interface ExecutionPayloadsTable {
  execution_id: string;
  /** JSONB: insira com `JSON.stringify`. */
  data: ColumnType<unknown, string | null | undefined, string | null>;
  /** Chave no object storage quando o conteúdo passa de 1 MB. */
  data_ref: string | null;
  created_at: GeneratedTimestamp;
}

export interface NodeExecutionsTable {
  execution_id: string;
  node_id: string;
  node_name: string;
  run_index: Generated<number>;
  status: string;
  attempts: Generated<number>;
  pinned: Generated<boolean>;
  /** Saída reaproveitada de uma execução anterior (execução de um nó, spec 003 FR-020). */
  reused: Generated<boolean>;
  started_at: Timestamp;
  finished_at: Timestamp | null;
  items_in: Generated<number>;
  items_out: Generated<number>;
  /** JSONB: insira com `JSON.stringify`. */
  input_data: ColumnType<unknown, string | null | undefined, string | null>;
  input_sources: ColumnType<unknown, string | null | undefined, string | null>;
  output_data: ColumnType<unknown, string | null | undefined, string | null>;
  data_truncated: Generated<boolean>;
  data_ref: string | null;
  /** Dados alterados pelo mascaramento (spec 009): não servem para reaproveitamento. */
  data_masked: Generated<boolean>;
  error: ColumnType<unknown, string | null | undefined, string | null>;
  /** Saída do `console` do nó de código (spec 005, FR-012). */
  console: ColumnType<unknown, string | null | undefined, string | null>;
}

export interface CredentialsTable {
  id: Generated<string>;
  project_id: string;
  name: string;
  type: string;
  /** Envelope cifrado (`packages/db/src/crypto.ts`); nunca sai da API. */
  data_encrypted: Buffer;
  key_version: number;
  /** Provedor da chave mestra que cifrou a DEK (spec 009): `env` ou `vault`. */
  key_provider: ColumnType<string, string | undefined, string>;
  created_by: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface Database {
  users: UsersTable;
  roles: RolesTable;
  projects: ProjectsTable;
  project_members: ProjectMembersTable;
  audit_log: AuditLogTable;
  workflows: WorkflowsTable;
  workflow_versions: WorkflowVersionsTable;
  webhooks: WebhooksTable;
  executions: ExecutionsTable;
  node_executions: NodeExecutionsTable;
  execution_payloads: ExecutionPayloadsTable;
  credentials: CredentialsTable;
  group_role_mappings: GroupRoleMappingsTable;
  publish_requests: PublishRequestsTable;
  masking_rules: MaskingRulesTable;
  mcp_servers: McpServersTable;
  mcp_tool_policies: McpToolPoliciesTable;
  mcp_calls: McpCallsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Role = Selectable<RolesTable>;
export type Project = Selectable<ProjectsTable>;
export type ProjectMember = Selectable<ProjectMembersTable>;
export type AuditLogEntry = Selectable<AuditLogTable>;
export type NewAuditLogEntry = Insertable<AuditLogTable>;
export type Workflow = Selectable<WorkflowsTable>;
export type WorkflowVersion = Selectable<WorkflowVersionsTable>;
export type Execution = Selectable<ExecutionsTable>;
export type NodeExecution = Selectable<NodeExecutionsTable>;
export type NewNodeExecution = Insertable<NodeExecutionsTable>;
export type Credential = Selectable<CredentialsTable>;
export type GroupRoleMapping = Selectable<GroupRoleMappingsTable>;
export type PublishRequest = Selectable<PublishRequestsTable>;
export type MaskingRuleRow = Selectable<MaskingRulesTable>;
export type McpServerRow = Selectable<McpServersTable>;
export type McpToolPolicyRow = Selectable<McpToolPoliciesTable>;
export type McpCallRow = Selectable<McpCallsTable>;
