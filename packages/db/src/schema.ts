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
}

export interface ProjectMembersTable {
  project_id: string;
  user_id: string;
  role_id: number;
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
  credentials: CredentialsTable;
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
