import type { Permission, RoleName } from './rbac.js';
import type { PublishApproval } from './governance.js';
import type { AgentStepEvent } from './ai.js';
import type {
  ExecutionStatus,
  Item,
  NodeExecutionStatus,
  NodeOutput,
  WorkflowDefinition,
} from './workflow.js';

export type DependencyStatus = 'up' | 'down';

/**
 * `GET /health`. `idp` indica se o emissor OIDC responde (caso de borda da spec 001); com o login
 * pelo IdP desligado (spec 014), `disabled` e não é checado.
 */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  db: DependencyStatus;
  redis: DependencyStatus;
  idp: DependencyStatus | 'disabled';
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
  /** Spec 014: como a sessão atual foi aberta. */
  authMethod: 'local' | 'idp';
  /** Spec 014 (FR-007): a senha precisa ser trocada antes de usar a plataforma. */
  mustChangePassword: boolean;
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
  /** `idp`: herdado de grupo do IdP, sincronizado no login (spec 009, FR-005). */
  origin: 'manual' | 'idp';
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
  /** Versão em produção (spec 005, FR-001); `null` = nunca publicado. */
  publishedVersion: number | null;
  /** Publicado e com as rotas de webhook ativas. */
  active: boolean;
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
  /** Mensagem da versão (spec 009, FR-009): opcional ao salvar. */
  message?: string;
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
  /** Execução do nó dentro de um laço (spec 007, FR-009): 0, 1, 2... */
  runIndex: number;
  status: NodeExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  itemsIn: number;
  itemsOut: number;
  pinned: boolean;
  /** Saída reaproveitada de uma execução anterior (FR-020). */
  reused: boolean;
  /**
   * Spec 009, FR-015: com `reused`, os campos da saída que chegaram mascarados (ex.:
   * `headers.postman-token`), entregues assim ao nó seguinte.
   */
  maskedFields?: string[];
  /** Entrada/saída gravadas além do limite foram cortadas (FR-015). */
  dataTruncated: boolean;
  input: Record<string, Item[]> | null;
  output: NodeOutput | null;
  /** Saída do `console` do nó de código (spec 005, FR-012). */
  console: string[] | null;
  error: NodeExecutionError | null;
}

/**
 * Erro de uma execução. `reason` (spec 006) indica fim antecipado: `cancelled` (pedido do
 * usuário), `timeout` (timeout global do workflow) ou `worker_lost` (o worker caiu).
 */
export interface ExecutionErrorInfo {
  message: string;
  nodeId?: string;
  reason?: 'cancelled' | 'timeout' | 'worker_lost';
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
  error: ExecutionErrorInfo | null;
  /** Spec 005, FR-014: sem `execution:readData`, entrada, saída e console vêm omitidos. */
  dataRedacted: boolean;
  /** Definição executada (pode ser um rascunho não salvo, nas execuções de teste). */
  definition: WorkflowDefinition | null;
  nodes: NodeExecutionDetail[];
}

/** Linha de `GET /executions` (spec 005, FR-013). */
export interface ExecutionSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  projectId: string;
  workflowVersion: number | null;
  mode: 'test' | 'production';
  triggerType: string;
  triggeredBy: string | null;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

/** Paginação por cursor (`started_at`, `id`). */
export interface ExecutionList {
  items: ExecutionSummary[];
  nextCursor: string | null;
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
  runIndex: number;
  startedAt: string;
}

export interface NodeFinishedEvent {
  executionId: string;
  nodeId: string;
  /** Iteração (spec 007, FR-009). */
  runIndex: number;
  status: NodeExecutionStatus;
  itemsIn: number;
  itemsOut: number;
  durationMs: number;
  pinned: boolean;
  reused: boolean;
  /** Spec 009, FR-015: campos mascarados da saída reaproveitada. */
  maskedFields?: string[];
  dataTruncated: boolean;
  data: { input: Record<string, Item[]>; output: NodeOutput };
  /** Sem `execution:readData`, `data` vem vazio (spec 005, FR-014). */
  dataRedacted?: boolean;
  console?: string[];
  error: NodeExecutionError | null;
}

/** Chamada recebida na URL de teste do webhook (spec 005, FR-007). */
export interface TestWebhookReceivedEvent {
  executionId: string;
  workflowId: string;
  nodeId: string;
  /** Item entregue ao gatilho; omitido para quem não tem `execution:readData`. */
  payload?: Item;
}

export interface ExecutionFinishedEvent {
  executionId: string;
  /** `waiting` (spec 008): a execução pausou; um novo `executionStarted` vem na retomada. */
  status: ExecutionStatus;
  /** `null` quando a execução entrou em espera. */
  finishedAt: string | null;
  error: ExecutionErrorInfo | null;
}

export interface ExecutionEvents {
  executionStarted: ExecutionStartedEvent;
  nodeStarted: NodeStartedEvent;
  nodeFinished: NodeFinishedEvent;
  executionFinished: ExecutionFinishedEvent;
  testWebhookReceived: TestWebhookReceivedEvent;
  /** Spec 011, FR-006: passo do agente. */
  agentStep: AgentStepEvent;
}

/** `POST /workflows/:id/publish` (spec 005, FR-001). */
export interface PublishRequest {
  /** Versão a publicar; padrão: a última salva. */
  version?: number;
  /** Mensagem da publicação: obrigatória (spec 009, FR-009). */
  message: string;
}

export interface PublishResponse {
  publishedVersion: number | null;
  active: boolean;
  webhooks: { method: string; path: string }[];
  warnings: WorkflowIssue[];
  /** Projeto com aprovação (spec 009, FR-011): a publicação virou um pedido pendente. */
  pendingApproval?: PublishApproval;
}

/** `POST /workflows/:id/listen-test-webhook` (spec 005, FR-007). */
export interface ListenTestWebhookResponse {
  webhooks: { nodeId: string; method: string; path: string }[];
  expiresAt: string;
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

/** `GET /projects/:id/queue-stats` (spec 006, FR-012). */
export interface QueueStats {
  /** Execuções do projeto em andamento agora. */
  running: number;
  /** Execuções do projeto esperando vaga na fila. */
  queued: number;
  /** Cota de execuções simultâneas do projeto. */
  limit: number;
  /** `true` quando a cota foi definida para o projeto (senão, é o padrão da plataforma). */
  customLimit: boolean;
}

/** `PUT /projects/:id/quota` (spec 006, FR-012): `null` volta ao padrão da plataforma. */
export interface ProjectQuotaRequest {
  maxConcurrentExecutions: number | null;
}
