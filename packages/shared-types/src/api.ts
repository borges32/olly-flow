import type { Permission, RoleName } from './rbac.js';
import type {
  ExecutionStatus,
  Item,
  NodeExecutionStatus,
  NodeOutput,
  WorkflowDefinition,
} from './workflow.js';

export type DependencyStatus = 'up' | 'down';

/** `GET /health`. `idp` indica se o emissor OIDC responde (caso de borda da spec 001). */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  db: DependencyStatus;
  redis: DependencyStatus;
  idp: DependencyStatus;
}

/**
 * Permissões efetivas (spec 002): `global` vale em todos os projetos (administrador global);
 * `projects` traz, por id de projeto, as permissões do papel do usuário naquele projeto.
 */
export interface EffectivePermissions {
  global: Permission[];
  projects: Record<string, Permission[]>;
}

/** `GET /api/v1/me`. */
export interface MeResponse {
  id: string;
  email: string;
  name: string | null;
  permissions: EffectivePermissions;
}

/** Problema apontado pela validação (corpo, estrutura do workflow...). */
export interface ApiIssue {
  code?: string;
  message: string;
  /** Caminho do campo no corpo da requisição. */
  path?: (string | number)[];
  /** Nós do workflow envolvidos. */
  nodeIds?: string[];
}

/** Corpo padrão de erro da API. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    issues?: ApiIssue[];
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  /** Papel do usuário no projeto; `null` para o administrador global que não é membro. */
  role: RoleName | null;
}

export interface ProjectMember {
  userId: string;
  email: string;
  name: string | null;
  role: RoleName;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  email: string;
  name: string | null;
}

/** Problema estrutural de um workflow (espelha o `Issue` do `@olly/engine`). */
export interface WorkflowIssue {
  code: string;
  message: string;
  nodeIds: string[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDetail extends WorkflowSummary {
  projectId: string;
  definition: WorkflowDefinition;
  createdBy: string | null;
  /** Avisos da validação estrutural (ex.: nós órfãos). */
  warnings: WorkflowIssue[];
}

export interface WorkflowVersionSummary {
  version: number;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
  message: string | null;
}

/** `POST /projects/:id/workflows`. */
export interface CreateWorkflowRequest {
  name: string;
  definition?: WorkflowDefinition;
}

/** `PUT /workflows/:id`. */
export interface SaveWorkflowRequest {
  name?: string;
  definition: WorkflowDefinition;
  baseVersion: number;
}

/** `POST /workflows/:id/test-run` (spec 003, FR-011). Aceita a definição ainda não salva. */
export interface TestRunRequest {
  definition: WorkflowDefinition;
  /** Substitui `definition.pinData` quando informado. */
  pinData?: Record<string, Item[]>;
  /** "Executar até este nó". */
  destinationNodeId?: string;
  /**
   * Execução de um nó (FR-020): por id do nó, a execução de teste cuja saída é reaproveitada.
   * Vale só para execuções deste workflow, nós com sucesso e dados completos (não truncados).
   */
  reuse?: Record<string, string>;
}

export interface TestRunResponse {
  executionId: string;
}

export interface NodeExecutionError {
  name: string;
  message: string;
}

export interface NodeExecutionDetail {
  nodeId: string;
  nodeName: string;
  status: NodeExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  itemsIn: number;
  itemsOut: number;
  pinned: boolean;
  /** Saída reaproveitada de uma execução anterior (FR-020). */
  reused: boolean;
  /** Entrada/saída gravadas além do limite foram cortadas (FR-015). */
  dataTruncated: boolean;
  input: Record<string, Item[]> | null;
  output: NodeOutput | null;
  error: NodeExecutionError | null;
}

/** `GET /executions/:id` (FR-014). */
export interface ExecutionDetail {
  id: string;
  workflowId: string;
  projectId: string;
  workflowVersion: number | null;
  mode: 'test' | 'production';
  triggerType: string;
  triggeredBy: string | null;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  error: { message: string; nodeId?: string } | null;
  nodes: NodeExecutionDetail[];
}

/** Eventos do namespace WebSocket `/executions`, sala `execution:<id>` (FR-012). */
export interface ExecutionStartedEvent {
  executionId: string;
  workflowId: string;
  startedAt: string;
}

export interface NodeStartedEvent {
  executionId: string;
  nodeId: string;
  startedAt: string;
}

export interface NodeFinishedEvent {
  executionId: string;
  nodeId: string;
  status: NodeExecutionStatus;
  itemsIn: number;
  itemsOut: number;
  durationMs: number;
  pinned: boolean;
  reused: boolean;
  dataTruncated: boolean;
  data: { input: Record<string, Item[]>; output: NodeOutput };
  error: NodeExecutionError | null;
}

export interface ExecutionFinishedEvent {
  executionId: string;
  status: ExecutionStatus;
  finishedAt: string;
  error: { message: string; nodeId?: string } | null;
}

export interface ExecutionEvents {
  executionStarted: ExecutionStartedEvent;
  nodeStarted: NodeStartedEvent;
  nodeFinished: NodeFinishedEvent;
  executionFinished: ExecutionFinishedEvent;
}

/** `POST /workflows/:id/expressions/preview` (FR-018). */
export interface ExpressionPreviewRequest {
  definition: WorkflowDefinition;
  nodeId: string;
  expression: string;
  /** Execução de teste cujos dados servem de contexto; sem ela, `$json` é vazio. */
  executionId?: string;
  itemIndex?: number;
}

export type ExpressionPreviewResponse =
  { ok: true; value: unknown } | { ok: false; error: { kind: string; message: string } };

/** Credencial sem os campos secretos (spec 004, FR-002). */
export interface CredentialSummary {
  id: string;
  projectId: string;
  name: string;
  type: string;
  /** Campos não secretos; os `x-secret` nunca saem da API. */
  publicFields: Record<string, unknown>;
  /** Campos secretos que têm valor salvo (para o formulário indicar "manter atual"). */
  secretFieldsSet: string[];
  createdAt: string;
  updatedAt: string;
}

/** `POST /projects/:id/credentials`. */
export interface CreateCredentialRequest {
  name: string;
  type: string;
  data: Record<string, unknown>;
}

/** `PUT /credentials/:id`: campo secreto ausente ou vazio mantém o valor atual (HU-1.1). */
export interface UpdateCredentialRequest {
  name?: string;
  data?: Record<string, unknown>;
}

/** `POST /credentials/:id/test` (FR-005). `url` é exigida pelos tipos HTTP genéricos. */
export interface CredentialTestRequest {
  url?: string;
}

export interface CredentialTestResponse {
  ok: boolean;
  message: string;
}

/** `GET /credentials/:id/postgres/columns` (FR-016). */
export interface PostgresColumn {
  name: string;
  type: string;
  nullable: boolean;
  hasDefault: boolean;
}
