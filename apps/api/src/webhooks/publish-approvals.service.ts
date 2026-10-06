import { Inject, Injectable } from '@nestjs/common';
import type { Db, PublishRequestStatus } from '@olly/db';
import type { PublishApproval, PublishResponse } from '@olly/shared-types';
import { sql } from 'kysely';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ConflictError, NotFoundError, PermissionDeniedError } from '../common/errors.js';
import { DB } from '../core/tokens.js';
import { PublishingService } from './publishing.service.js';

const UNIQUE_VIOLATION = '23505';
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export interface ApprovalFilter {
  status?: PublishRequestStatus;
  workflowId?: string;
}

/**
 * Aprovação "quatro olhos" da publicação (spec 009, FR-011; plan §4). Com a aprovação ativa no
 * projeto, publicar abre um pedido; só **outro** usuário com `workflow:publish` no projeto aprova
 * (o que publica de fato) ou rejeita, com comentário. Tudo auditado.
 */
@Injectable()
export class PublishApprovalsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PublishingService) private readonly publishing: PublishingService,
  ) {}

  async requestOrPublish(
    ctx: AuditContext,
    user: AuthenticatedUser,
    workflowId: string,
    body: { version?: number; message: string },
  ): Promise<PublishResponse> {
    const workflow = await this.db
      .selectFrom('workflows')
      .innerJoin('projects', 'projects.id', 'workflows.project_id')
      .select([
        'projects.require_publish_approval',
        'workflows.published_version',
        'workflows.active',
      ])
      .where('workflows.id', '=', workflowId)
      .executeTakeFirst();
    if (!workflow) throw new NotFoundError('Workflow não encontrado');
    if (!workflow.require_publish_approval) {
      return this.publishing.publish(ctx, workflowId, body.version, body.message);
    }
    const prepared = await this.publishing.prepare(workflowId, body.version);
    const id = await this.db
      .transaction()
      .execute(async (trx) => {
        const row = await trx
          .insertInto('publish_requests')
          .values({
            workflow_id: workflowId,
            project_id: prepared.projectId,
            version: prepared.version,
            message: body.message,
            requested_by: user.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, ctx, {
          action: 'workflow.publish_request',
          entityType: 'workflow',
          entityId: workflowId,
          details: { requestId: row.id, version: prepared.version, message: body.message },
        });
        return row.id;
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
          throw new ConflictError('Já existe um pedido de publicação pendente para este workflow');
        }
        throw error;
      });
    return {
      publishedVersion: workflow.published_version,
      active: workflow.active,
      webhooks: [],
      warnings: prepared.warnings,
      pendingApproval: await this.get(id),
    };
  }

  /** SC-006: o autor não aprova o próprio pedido. A aprovação publica a versão pedida. */
  async approve(
    ctx: AuditContext,
    user: AuthenticatedUser,
    id: string,
    comment?: string,
  ): Promise<PublishApproval> {
    const request = await this.decidable(user, id);
    const claimed = await this.db
      .updateTable('publish_requests')
      .set({
        status: 'approved',
        decided_by: user.id,
        comment: comment ?? null,
        decided_at: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (claimed.numUpdatedRows === 0n) throw new ConflictError('O pedido já foi decidido');
    try {
      await this.publishing.publish(ctx, request.workflow_id, request.version, request.message, {
        requestId: id,
        requestedBy: request.requested_by,
      });
    } catch (error) {
      // A publicação falhou (ex.: caminho de webhook ocupado): o pedido volta a ficar pendente.
      await this.db
        .updateTable('publish_requests')
        .set({ status: 'pending', decided_by: null, comment: null, decided_at: null })
        .where('id', '=', id)
        .execute();
      throw error;
    }
    await this.audit.record(this.db, ctx, {
      action: 'workflow.publish_request.approve',
      entityType: 'workflow',
      entityId: request.workflow_id,
      details: { requestId: id, version: request.version, ...(comment && { comment }) },
    });
    return this.get(id);
  }

  async reject(
    ctx: AuditContext,
    user: AuthenticatedUser,
    id: string,
    comment?: string,
  ): Promise<PublishApproval> {
    const request = await this.decidable(user, id);
    await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('publish_requests')
        .set({
          status: 'rejected',
          decided_by: user.id,
          comment: comment ?? null,
          decided_at: sql<Date>`now()`,
        })
        .where('id', '=', id)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) throw new ConflictError('O pedido já foi decidido');
      await this.audit.record(trx, ctx, {
        action: 'workflow.publish_request.reject',
        entityType: 'workflow',
        entityId: request.workflow_id,
        details: { requestId: id, version: request.version, ...(comment && { comment }) },
      });
    });
    return this.get(id);
  }

  /** O próprio autor desiste do pedido. */
  async cancel(ctx: AuditContext, user: AuthenticatedUser, id: string): Promise<PublishApproval> {
    const request = await this.load(id);
    if (request.requested_by !== user.id) {
      throw new PermissionDeniedError('Só o autor pode cancelar o pedido');
    }
    await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('publish_requests')
        .set({ status: 'cancelled', decided_at: sql<Date>`now()` })
        .where('id', '=', id)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) throw new ConflictError('O pedido já foi decidido');
      await this.audit.record(trx, ctx, {
        action: 'workflow.publish_request.cancel',
        entityType: 'workflow',
        entityId: request.workflow_id,
        details: { requestId: id },
      });
    });
    return this.get(id);
  }

  /**
   * Pedidos visíveis ao usuário: os dos projetos em que pode publicar (para decidir) e os que
   * ele mesmo abriu (para acompanhar). Mais recentes primeiro.
   */
  async list(user: AuthenticatedUser, filter: ApprovalFilter): Promise<PublishApproval[]> {
    const publishable = Object.entries(user.permissions.projects)
      .filter(([, perms]) => perms.includes('workflow:publish'))
      .map(([projectId]) => projectId);
    const all = user.isAdmin || user.permissions.global.includes('workflow:publish');
    const ids = await this.db
      .selectFrom('publish_requests')
      .select('id')
      .$if(!all, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('requested_by', '=', user.id),
            ...(publishable.length ? [eb('project_id', 'in', publishable)] : []),
          ]),
        ),
      )
      .$if(filter.status !== undefined, (qb) =>
        qb.where('status', '=', filter.status as PublishRequestStatus),
      )
      .$if(filter.workflowId !== undefined, (qb) =>
        qb.where('workflow_id', '=', filter.workflowId as string),
      )
      .orderBy('created_at', 'desc')
      .limit(200)
      .execute();
    return Promise.all(ids.map((r) => this.get(r.id)));
  }

  async get(id: string): Promise<PublishApproval> {
    const r = await this.db
      .selectFrom('publish_requests as pr')
      .innerJoin('workflows as w', 'w.id', 'pr.workflow_id')
      .innerJoin('projects as p', 'p.id', 'pr.project_id')
      .innerJoin('users as ru', 'ru.id', 'pr.requested_by')
      .leftJoin('users as du', 'du.id', 'pr.decided_by')
      .select([
        'pr.id',
        'pr.workflow_id',
        'w.name as workflow_name',
        'pr.project_id',
        'p.name as project_name',
        'pr.version',
        'pr.message',
        'pr.status',
        'pr.requested_by',
        'ru.name as requested_by_name',
        'ru.email as requested_by_email',
        'pr.decided_by',
        'du.name as decided_by_name',
        'du.email as decided_by_email',
        'pr.comment',
        'pr.created_at',
        'pr.decided_at',
      ])
      .where('pr.id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundError('Pedido de publicação não encontrado');
    return {
      id: r.id,
      workflowId: r.workflow_id,
      workflowName: r.workflow_name,
      projectId: r.project_id,
      projectName: r.project_name,
      version: r.version,
      message: r.message,
      status: r.status,
      requestedBy: { id: r.requested_by, name: r.requested_by_name, email: r.requested_by_email },
      decidedBy: r.decided_by
        ? { id: r.decided_by, name: r.decided_by_name, email: r.decided_by_email ?? '' }
        : null,
      comment: r.comment,
      createdAt: r.created_at.toISOString(),
      decidedAt: iso(r.decided_at),
    };
  }

  private async load(id: string) {
    const row = await this.db
      .selectFrom('publish_requests')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError('Pedido de publicação não encontrado');
    return row;
  }

  /** Pendente e decidido por outra pessoa (FR-011). A permissão no projeto vem da rota. */
  private async decidable(user: AuthenticatedUser, id: string) {
    const request = await this.load(id);
    if (request.status !== 'pending') throw new ConflictError('O pedido já foi decidido');
    if (request.requested_by === user.id) {
      throw new PermissionDeniedError('O autor do pedido não pode aprová-lo nem rejeitá-lo');
    }
    return request;
  }
}
