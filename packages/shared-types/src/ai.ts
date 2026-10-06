// Spec 011: AI Agent (passos, aprovação humana, uso e custo).

export const AGENT_STEP_KINDS = ['model', 'tool', 'approval', 'final', 'error'] as const;
export type AgentStepKind = (typeof AGENT_STEP_KINDS)[number];

/** Passo do agente (FR-006). `content` já mascarado; ausente sem `execution:readData`. */
export interface AgentStep {
  id: string;
  executionId: string;
  nodeId: string;
  runIndex: number;
  itemIndex: number;
  stepIndex: number;
  kind: AgentStepKind;
  toolName: string | null;
  content?: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
}

/** Evento WebSocket `agentStep` (FR-006): sem `content` para quem não lê os dados. */
export interface AgentStepEvent extends Omit<AgentStep, 'id'> {
  contentRedacted?: boolean;
}

export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'cancelled',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Pedido de aprovação humana (FR-010, FR-011). Argumentos mascarados para exibição. */
export interface AgentApproval {
  id: string;
  executionId: string;
  projectId: string;
  projectName: string;
  workflowId: string;
  workflowName: string;
  nodeId: string;
  itemIndex: number;
  tool: string;
  arguments: unknown;
  reason: string;
  status: ApprovalStatus;
  expiresAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
  createdAt: string;
}

/** `POST /approvals/:id/approve|reject`. */
export interface ApprovalDecisionRequest {
  comment?: string;
}

/** Totais de uso de LLM (FR-014). Custo `null` quando falta preço de algum modelo. */
export interface AiUsageTotals {
  inputTokens: number;
  outputTokens: number;
  calls: number;
  cost: number | null;
  currency: string | null;
}

/** `GET /executions/:id/ai-usage`. */
export interface ExecutionAiUsage extends AiUsageTotals {
  byModel: (AiUsageTotals & { model: string; provider: string })[];
}

/** Linha de `GET /ai-usage` (por projeto) e `GET /projects/:id/ai-usage` (por workflow). */
export interface AiUsageRow extends AiUsageTotals {
  id: string;
  name: string;
}

/** `GET /projects/:id/ai-usage`. */
export interface ProjectAiUsage {
  from: string;
  to: string;
  total: AiUsageTotals;
  /** Tokens usados no mês corrente (base do limite, FR-015). */
  monthTokens: number;
  monthlyTokenLimit: number | null;
  byWorkflow: AiUsageRow[];
}

/** Preço por milhão de tokens (FR-014). */
export interface AiPricing {
  model: string;
  provider: string;
  inputPer1m: number;
  outputPer1m: number;
  currency: string;
  note: string | null;
  updatedAt: string;
}

/** Configuração de IA do projeto (FR-002, FR-015). */
export interface ProjectAiSettings {
  /** `null`: todos os modelos permitidos na instalação. */
  allowedModels: string[] | null;
  /** `null`: sem limite mensal de tokens. */
  monthlyTokenLimit: number | null;
  /** Modelos da instalação (cadastro em Administração › IA), para a escolha. */
  installationModels: string[];
}

/** Modelo permitido na instalação (FR-002): cadastro da administração, `GET /ai-models`. */
export interface AiModel {
  model: string;
  note: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}
