import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ApprovalRequestRow, Db } from '@olly/db';
import type { Masker, WaitingNode } from '@olly/engine';
import type { AgentApproval, ApprovalStatus } from '@olly/shared-types';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ConflictError, NotFoundError } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { ExecutionWaits } from '../executions/waits.service.js';
import { hasProjectPermission } from '../rbac/ability.factory.js';

/** Decisões entregues ao nó em espera (lidas pelo Agent em `ctx.resume.value`). */
interface ApprovalDelivery {
  approvals: Record<string, { approved: boolean; comment: string | null }>;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Aprovação humana de ações destrutivas (spec 011, FR-010, FR-011, plan §6). O pedido nasce da
 * espera do Agent (spec 008); a decisão (ou a expiração, rejeição automática) é entregue ao nó
 * e, quando todos os pedidos dele estão decididos, a execução retoma. Tudo é auditado.
 */
@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger('Approvals');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ExecutionWaits) private readonly waits: ExecutionWaits,
  ) {}

  /** Cria os pedidos dos nós em espera (repetidos na retomada são ignorados). */
  async createFromWaiting(input: {
    executionId: string;
    projectId: string;
    workflowId: string;
    waiting: WaitingNode[];
    masker: Masker;
  }): Promise<number> {
    const expiresAt = new Date(Date.now() + this.config.ai.approvalTimeoutMs);
    const execution = await this.db
      .selectFrom('executions')
      .select('triggered_by')
      .where('id', '=', input.executionId)
      .limit(1)
      .executeTakeFirst();
    let created = 0;
    for (const node of input.waiting) {
      for (const approval of node.request.approvals ?? []) {
        const row = await this.db
          .insertInto('approval_requests')
          .values({
            execution_id: input.executionId,
            project_id: input.projectId,
            workflow_id: input.workflowId,
            node_id: node.nodeId,
            run_index: node.runIndex,
            item_index: approval.itemIndex,
            approval_key: approval.key,
            tool: approval.tool,
            // FR-010: argumentos mascarados para exibição.
            arguments: JSON.stringify(input.masker.mask(approval.arguments ?? null).value),
            reason: approval.reason,
            expires_at: expiresAt,
          })
          .onConflict((oc) =>
            oc.columns(['execution_id', 'node_id', 'run_index', 'approval_key']).doNothing(),
          )
          .returning('id')
          .executeTakeFirst();
        if (!row) continue;
        created++;
        await this.audit.record(
          this.db,
          { userId: execution?.triggered_by ?? null, ip: null },
          {
            action: 'agent.approval_requested',
            entityType: 'approval_request',
            entityId: row.id,
            details: {
              projectId: input.projectId,
              executionId: input.executionId,
              nodeId: node.nodeId,
              tool: approval.tool,
            },
          },
        );
      }
    }
    return created;
  }

  private toView(
    row: ApprovalRequestRow & {
      project_name: string;
      workflow_name: string;
      decided_by_name: string | null;
    },
  ): AgentApproval {
    return {
      id: row.id,
      executionId: row.execution_id,
      projectId: row.project_id,
      projectName: row.project_name,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      nodeId: row.node_id,
      itemIndex: row.item_index,
      tool: row.tool,
      arguments: row.arguments,
      reason: row.reason,
      status: row.status,
      expiresAt: row.expires_at.toISOString(),
      decidedBy: row.decided_by,
      decidedByName: row.decided_by_name,
      decidedAt: iso(row.decided_at),
      comment: row.comment,
      createdAt: row.created_at.toISOString(),
    };
  }

  private baseQuery() {
    return this.db
      .selectFrom('approval_requests as a')
      .innerJoin('projects as p', 'p.id', 'a.project_id')
      .innerJoin('workflows as w', 'w.id', 'a.workflow_id')
      .leftJoin('users as u', 'u.id', 'a.decided_by')
      .selectAll('a')
      .select(['p.name as project_name', 'w.name as workflow_name', 'u.name as decided_by_name']);
  }

  /** FR-011: pedidos dos projetos em que o usuário pode executar (`workflow:execute`). */
  async list(
    user: AuthenticatedUser,
    filters: { status?: ApprovalStatus; executionId?: string },
  ): Promise<AgentApproval[]> {
    const rows = await this.baseQuery()
      .$if(filters.status !== undefined, (q) =>
        q.where('a.status', '=', filters.status ?? 'pending'),
      )
      .$if(filters.executionId !== undefined, (q) =>
        q.where('a.execution_id', '=', filters.executionId ?? ''),
      )
      .orderBy('a.created_at', 'desc')
      .limit(200)
      .execute();
    return rows
      .filter((r) => hasProjectPermission(user, 'workflow:execute', r.project_id))
      .map((r) => this.toView(r));
  }

  async decide(
    ctx: AuditContext,
    approvalId: string,
    approved: boolean,
    comment: string | null,
  ): Promise<AgentApproval> {
    const decided = await this.db
      .updateTable('approval_requests')
      .set({
        status: approved ? 'approved' : 'rejected',
        decided_by: ctx.userId,
        decided_at: new Date(),
        comment,
      })
      .where('id', '=', approvalId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();
    if (!decided) {
      const exists = await this.db
        .selectFrom('approval_requests')
        .select('status')
        .where('id', '=', approvalId)
        .executeTakeFirst();
      if (!exists) throw new NotFoundError('Pedido de aprovação não encontrado');
      throw new ConflictError(`O pedido já foi decidido (${exists.status})`);
    }
    await this.audit.record(this.db, ctx, {
      action: approved ? 'agent.approval_approved' : 'agent.approval_rejected',
      entityType: 'approval_request',
      entityId: approvalId,
      details: {
        projectId: decided.project_id,
        executionId: decided.execution_id,
        tool: decided.tool,
        ...(comment && { comment }),
      },
    });
    await this.deliver(decided, approved, comment);
    const row = await this.baseQuery().where('a.id', '=', approvalId).executeTakeFirstOrThrow();
    return this.toView(row);
  }

  /**
   * Entrega a decisão ao nó em espera; com todos os pedidos dele decididos, a execução retoma
   * (a rejeição volta ao agente como resultado da ferramenta).
   */
  private async deliver(
    row: ApprovalRequestRow,
    approved: boolean,
    comment: string | null,
  ): Promise<void> {
    const pending = await this.db
      .selectFrom('approval_requests')
      .select('id')
      .where('execution_id', '=', row.execution_id)
      .where('node_id', '=', row.node_id)
      .where('run_index', '=', row.run_index)
      .where('status', '=', 'pending')
      .limit(1)
      .executeTakeFirst();
    await this.waits
      .deliver(
        row.execution_id,
        row.node_id,
        (current) => {
          const delivery = (current as ApprovalDelivery | undefined) ?? { approvals: {} };
          delivery.approvals[row.approval_key] = { approved, comment };
          return delivery;
        },
        pending === undefined,
      )
      .catch((error: unknown) => {
        // A execução pode ter sido cancelada entre o pedido e a decisão.
        this.logger.warn(`Decisão de ${row.id} não entregue: ${String(error)}`);
      });
  }

  /** NFR-002: pedidos vencidos são rejeitados automaticamente (e auditados). */
  async expireDue(now = new Date()): Promise<number> {
    const expired = await this.db
      .updateTable('approval_requests')
      .set({ status: 'expired', decided_at: now, comment: 'Prazo de aprovação expirado' })
      .where('status', '=', 'pending')
      .where('expires_at', '<=', now)
      .returningAll()
      .execute();
    for (const row of expired) {
      await this.audit.record(
        this.db,
        { userId: null, ip: null },
        {
          action: 'agent.approval_expired',
          entityType: 'approval_request',
          entityId: row.id,
          details: { projectId: row.project_id, executionId: row.execution_id, tool: row.tool },
        },
      );
      await this.deliver(row, false, 'Prazo de aprovação expirado');
    }
    return expired.length;
  }

  /** Execução cancelada: os pedidos pendentes dela deixam de valer. */
  async cancelForExecution(executionId: string): Promise<void> {
    await this.db
      .updateTable('approval_requests')
      .set({ status: 'cancelled', decided_at: new Date() })
      .where('execution_id', '=', executionId)
      .where('status', '=', 'pending')
      .execute();
  }

  /** Projeto do pedido (escopo RBAC `{ approval }`). */
  async projectOf(approvalId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('approval_requests')
      .select('project_id')
      .where('id', '=', approvalId)
      .executeTakeFirst();
    return row?.project_id ?? null;
  }
}
