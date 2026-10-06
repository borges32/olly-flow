import type { RoleName } from './rbac.js';
import type { Edge, WorkflowDefinition, WorkflowNode } from './workflow.js';

// Spec 009: governança, SSO, versionamento e LGPD.

// ---------------------------------------------------------------------------------------------
// Mascaramento (FR-014 a FR-016)
// ---------------------------------------------------------------------------------------------

export const MASKING_KINDS = ['field', 'pattern'] as const;
export type MaskingKind = (typeof MASKING_KINDS)[number];

export const MASKING_ACTIONS = ['redact', 'partial', 'hash'] as const;
export type MaskingAction = (typeof MASKING_ACTIONS)[number];

/** Detectores de valor embutidos (regras `pattern`). */
export const MASKING_DETECTORS = [
  'cpf',
  'cnpj',
  'card',
  'email',
  'phone',
  'jwt',
  'apiKey',
] as const;
export type MaskingDetector = (typeof MASKING_DETECTORS)[number];

/** O essencial de uma regra para mascarar (o motor não precisa do resto). */
export interface MaskingRuleSpec {
  kind: MaskingKind;
  /** `field`: glob sobre o nome ou o caminho do campo (`*token*`, `cliente.cpf`). `pattern`: detector. */
  matcher: string;
  action: MaskingAction;
}

export interface MaskingRule extends MaskingRuleSpec {
  id: string;
  scope: 'global' | 'project';
  projectId: string | null;
  enabled: boolean;
  /** Regra padrão (FR-016): pode ser desativada, não excluída. */
  builtin: boolean;
  description: string | null;
}

/** `POST`/`PUT` de regra de mascaramento. */
export interface MaskingRuleInput extends MaskingRuleSpec {
  enabled?: boolean;
  description?: string | null;
}

/**
 * Regras padrão ativas (FR-016), iguais às semeadas na migration `0009_governanca`. Usadas nos
 * logs antes de as regras do banco serem carregadas.
 */
export const DEFAULT_MASKING_RULES: readonly MaskingRuleSpec[] = [
  { kind: 'pattern', matcher: 'cpf', action: 'partial' },
  { kind: 'pattern', matcher: 'cnpj', action: 'partial' },
  { kind: 'pattern', matcher: 'card', action: 'partial' },
  { kind: 'pattern', matcher: 'jwt', action: 'redact' },
  { kind: 'pattern', matcher: 'apiKey', action: 'redact' },
  { kind: 'field', matcher: '*cpf*', action: 'partial' },
  { kind: 'field', matcher: '*cnpj*', action: 'partial' },
  { kind: 'field', matcher: '*password*', action: 'redact' },
  { kind: 'field', matcher: '*senha*', action: 'redact' },
  { kind: 'field', matcher: '*token*', action: 'redact' },
  { kind: 'field', matcher: '*authorization*', action: 'redact' },
  { kind: 'field', matcher: '*secret*', action: 'redact' },
];

// ---------------------------------------------------------------------------------------------
// Projeto (FR-011, FR-012, FR-017, FR-019)
// ---------------------------------------------------------------------------------------------

export const SAVE_EXECUTION_DATA = ['all', 'errorsOnly', 'none'] as const;
export type SaveExecutionDataPolicy = (typeof SAVE_EXECUTION_DATA)[number];

export interface RetentionPolicy {
  /** Dias até remover os dados (entrada/saída) das execuções. */
  dataDays: number;
  /** Dias até remover as execuções (metadados). */
  metadataDays: number;
}

/** `GET /projects/:id/settings`. */
export interface ProjectSettings {
  requirePublishApproval: boolean;
  executorCanReadData: boolean;
  /** Padrão dos workflows do projeto; `settings.saveExecutionData` do workflow prevalece. */
  saveExecutionData: SaveExecutionDataPolicy;
  /** Valores do projeto (`null` = padrão da plataforma). */
  retention: { dataDays: number | null; metadataDays: number | null };
  /** Retenção efetiva (com os padrões aplicados). */
  effectiveRetention: RetentionPolicy;
}

/** `PUT /projects/:id/settings`: só os campos enviados mudam. */
export interface ProjectSettingsUpdate {
  requirePublishApproval?: boolean;
  executorCanReadData?: boolean;
  saveExecutionData?: SaveExecutionDataPolicy;
  retention?: { dataDays?: number | null; metadataDays?: number | null };
}

// ---------------------------------------------------------------------------------------------
// SSO e usuários (FR-004 a FR-007)
// ---------------------------------------------------------------------------------------------

export interface GroupRoleMapping {
  id: string;
  idpGroup: string;
  /** `null` = papel em todos os projetos. */
  projectId: string | null;
  projectName: string | null;
  role: RoleName;
  createdAt: string;
}

export interface GroupRoleMappingInput {
  idpGroup: string;
  projectId: string | null;
  role: RoleName;
}

/** `POST /auth/login`: registra o login e sincroniza os vínculos herdados do IdP. */
export interface LoginResponse {
  userId: string;
  /** Vínculos por grupo do IdP depois da sincronização. */
  idpMemberships: { projectId: string; role: RoleName }[];
}

/** Usuário na administração (`GET /admin/users`). */
export interface UserAdminSummary {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// Versões e diff (FR-008 a FR-010)
// ---------------------------------------------------------------------------------------------

/** Operação JSON Patch (RFC 6902). */
export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

export interface NodeChange {
  id: string;
  name: string;
  /** Nome na versão de origem, quando o nó foi renomeado. */
  previousName?: string;
  type?: { from: string; to: string };
  params: JsonPatchOperation[];
  settings: JsonPatchOperation[];
  /** Outras propriedades alteradas (credencial, desativado). */
  other: JsonPatchOperation[];
  position?: { from: [number, number]; to: [number, number] };
}

/** `GET /workflows/:id/diff?from=&to=`. */
export interface WorkflowDiff {
  from: number;
  to: number;
  nodes: { added: WorkflowNode[]; removed: WorkflowNode[]; changed: NodeChange[] };
  edges: { added: Edge[]; removed: Edge[] };
  settings: JsonPatchOperation[];
}

/** `GET /workflows/:id/versions/:v`. */
export interface WorkflowVersionDetail {
  version: number;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
  message: string | null;
  definition: WorkflowDefinition;
}

// ---------------------------------------------------------------------------------------------
// Aprovação de publicação (FR-011)
// ---------------------------------------------------------------------------------------------

export type PublishApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface PublishApproval {
  id: string;
  workflowId: string;
  workflowName: string;
  projectId: string;
  projectName: string;
  version: number;
  message: string;
  status: PublishApprovalStatus;
  requestedBy: { id: string; name: string | null; email: string };
  decidedBy: { id: string; name: string | null; email: string } | null;
  comment: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/** `POST /publish-requests/:id/approve|reject`. */
export interface PublishDecisionRequest {
  comment?: string;
}

// ---------------------------------------------------------------------------------------------
// Auditoria (FR-018)
// ---------------------------------------------------------------------------------------------

export interface AuditRecord {
  id: string;
  createdAt: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: unknown;
  ip: string | null;
}

/** `GET /audit`: mais recentes primeiro; `nextCursor` continua a listagem. */
export interface AuditList {
  items: AuditRecord[];
  nextCursor: string | null;
}
