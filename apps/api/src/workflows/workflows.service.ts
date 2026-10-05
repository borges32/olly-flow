import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@olly/db';
import { validateWorkflow, type Issue } from '@olly/engine';
import type { NodeRegistry } from '@olly/nodes';
import type {
  Paginated,
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowSummary,
  WorkflowVersionSummary,
} from '@olly/shared-types';
import { sql } from 'kysely';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  UnprocessableError,
} from '../common/errors.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { hasProjectPermission } from '../rbac/ability.factory.js';
import { WebhookRegistry } from '../webhooks/webhook-registry.js';
import { DB } from '../core/tokens.js';
import { NODE_REGISTRY } from '../node-types/node-types.module.js';
import type {
  CreateWorkflowBody,
  ListWorkflowsQuery,
  SaveWorkflowBody,
} from './workflows.schemas.js';

const EMPTY_DEFINITION: WorkflowDefinition = { nodes: [], edges: [], settings: {} };

const iso = (d: Date) => d.toISOString();

/** Workflows versionados (spec 002, FR-001 a FR-004), com auditoria (FR-014). */
@Injectable()
export class WorkflowsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NODE_REGISTRY) private readonly registry: NodeRegistry,
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
    @Inject(WebhookRegistry) private readonly webhooks: WebhookRegistry,
  ) {}

  /**
   * Spec 004, FR-007 (plan §10): nó que passa a usar uma credencial exige `credential:use`; a
   * credencial precisa ser do projeto e de um tipo aceito pelo nó. Referências que não mudaram
   * não são revalidadas (a credencial pode ter sido excluída depois).
   */
  private async checkCredentialRefs(
    user: AuthenticatedUser,
    projectId: string,
    definition: WorkflowDefinition,
    previous?: WorkflowDefinition,
  ): Promise<void> {
    const before = new Map(previous?.nodes.map((n) => [n.id, n.credentialId]) ?? []);
    const changed = definition.nodes.filter(
      (n) => n.credentialId && before.get(n.id) !== n.credentialId,
    );
    if (changed.length === 0) return;
    if (!hasProjectPermission(user, 'credential:use', projectId)) {
      throw new PermissionDeniedError('Usar credenciais em nós exige a permissão credential:use');
    }
    const types = await this.credentials.typesById(
      projectId,
      changed.map((n) => n.credentialId as string),
    );
    const issues = changed.flatMap((n) => {
      const type = types.get(n.credentialId as string);
      const accepted = this.registry.get(n.type)?.credentialTypes ?? [];
      if (!type) {
        return [
          {
            code: 'CREDENTIAL_NOT_FOUND',
            message: `Nó "${n.name}": credencial não encontrada neste projeto`,
            nodeIds: [n.id],
          },
        ];
      }
      if (!accepted.includes(type)) {
        return [
          {
            code: 'CREDENTIAL_TYPE_MISMATCH',
            message: `Nó "${n.name}": credencial do tipo ${type} não serve para este nó`,
            nodeIds: [n.id],
          },
        ];
      }
      return [];
    });
    if (issues.length > 0) throw new UnprocessableError('Credencial inválida em nós', { issues });
  }

  /** Recusa com 422 se houver erros estruturais; devolve os avisos. */
  private validate(definition: WorkflowDefinition): Issue[] {
    const { errors, warnings } = validateWorkflow(definition, this.registry);
    if (errors.length > 0) {
      throw new UnprocessableError('O workflow tem erros de estrutura', {
        issues: errors.map((e) => ({ code: e.code, message: e.message, nodeIds: e.nodeIds })),
      });
    }
    return warnings;
  }

  async create(
    ctx: AuditContext,
    user: AuthenticatedUser,
    projectId: string,
    body: CreateWorkflowBody,
  ): Promise<WorkflowDetail> {
    const definition = body.definition ?? EMPTY_DEFINITION;
    const warnings = this.validate(definition);
    await this.checkCredentialRefs(user, projectId, definition);
    const id = await this.db.transaction().execute(async (trx) => {
      const wf = await trx
        .insertInto('workflows')
        .values({ project_id: projectId, name: body.name, created_by: ctx.userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('workflow_versions')
        .values({
          workflow_id: wf.id,
          version: 1,
          definition: JSON.stringify(definition),
          created_by: ctx.userId,
        })
        .execute();
      await this.audit.record(trx, ctx, {
        action: 'workflow.create',
        entityType: 'workflow',
        entityId: wf.id,
        details: { projectId, name: body.name, version: 1 },
      });
      return wf.id;
    });
    return { ...(await this.get(id)), warnings };
  }

  async list(projectId: string, query: ListWorkflowsQuery): Promise<Paginated<WorkflowSummary>> {
    const term = query.search ? `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
    const base = this.db
      .selectFrom('workflows')
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .$if(term !== undefined, (qb) => qb.where('name', 'ilike', term as string));
    const [{ total }, rows] = await Promise.all([
      base.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      base
        .select(['id', 'name', 'version', 'created_at', 'updated_at'])
        .orderBy('updated_at', 'desc')
        .orderBy('id')
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
        .execute(),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        version: r.version,
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
      })),
      total: Number(total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string): Promise<WorkflowDetail> {
    const row = await this.db
      .selectFrom('workflows')
      .innerJoin('workflow_versions', (join) =>
        join
          .onRef('workflow_versions.workflow_id', '=', 'workflows.id')
          .onRef('workflow_versions.version', '=', 'workflows.version'),
      )
      .select([
        'workflows.id',
        'workflows.project_id',
        'workflows.name',
        'workflows.version',
        'workflows.published_version',
        'workflows.active',
        'workflows.created_by',
        'workflows.created_at',
        'workflows.updated_at',
        'workflow_versions.definition',
      ])
      .where('workflows.id', '=', id)
      .where('workflows.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw new NotFoundError('Workflow não encontrado');
    const definition = row.definition as WorkflowDefinition;
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      version: row.version,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      createdBy: row.created_by,
      definition,
      warnings: validateWorkflow(definition, this.registry).warnings,
      publishedVersion: row.published_version,
      active: row.active,
    };
  }

  /**
   * Cada salvamento cria uma versão (FR-002). Concorrência otimista (FR-003): o UPDATE só
   * acontece se `baseVersion` ainda for a versão atual; senão, 409.
   */
  async save(
    ctx: AuditContext,
    user: AuthenticatedUser,
    id: string,
    body: SaveWorkflowBody,
  ): Promise<WorkflowDetail> {
    const warnings = this.validate(body.definition);
    const current = await this.get(id);
    await this.checkCredentialRefs(user, current.projectId, body.definition, current.definition);
    await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('workflows')
        .set((eb) => ({
          version: eb('version', '+', 1),
          updated_at: sql<Date>`now()`,
          name: body.name ?? eb.ref('name'),
        }))
        .where('id', '=', id)
        .where('version', '=', body.baseVersion)
        .where('deleted_at', 'is', null)
        .returning(['version', 'name'])
        .executeTakeFirst();
      if (!updated) {
        const current = await trx
          .selectFrom('workflows')
          .select('version')
          .where('id', '=', id)
          .executeTakeFirst();
        throw new ConflictError('O workflow foi alterado desde a versão carregada', {
          issues: [{ code: 'stale_version', message: `Versão atual: ${current?.version ?? '?'}` }],
        });
      }
      await trx
        .insertInto('workflow_versions')
        .values({
          workflow_id: id,
          version: updated.version,
          definition: JSON.stringify(body.definition),
          created_by: ctx.userId,
        })
        .execute();
      await this.audit.record(trx, ctx, {
        action: 'workflow.update',
        entityType: 'workflow',
        entityId: id,
        details: {
          version: updated.version,
          name: updated.name,
          nodes: body.definition.nodes.length,
        },
      });
    });
    return { ...(await this.get(id)), warnings };
  }

  /** Soft delete: as versões permanecem (caso de borda da spec). */
  async delete(ctx: AuditContext, id: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('workflows')
        .set({ deleted_at: sql<Date>`now()`, active: false })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returning('name')
        .executeTakeFirst();
      if (!row) throw new NotFoundError('Workflow não encontrado');
      // Spec 005: workflow excluído deixa de responder nos webhooks.
      await trx.deleteFrom('webhooks').where('workflow_id', '=', id).execute();
      await this.audit.record(trx, ctx, {
        action: 'workflow.delete',
        entityType: 'workflow',
        entityId: id,
        details: { name: row.name },
      });
    });
    this.webhooks.reload();
  }

  async versions(id: string): Promise<WorkflowVersionSummary[]> {
    const rows = await this.db
      .selectFrom('workflow_versions')
      .leftJoin('users', 'users.id', 'workflow_versions.created_by')
      .select([
        'workflow_versions.version',
        'workflow_versions.created_at',
        'workflow_versions.created_by',
        'workflow_versions.message',
        'users.name as created_by_name',
      ])
      .where('workflow_versions.workflow_id', '=', id)
      .orderBy('workflow_versions.version', 'desc')
      .execute();
    return rows.map((r) => ({
      version: r.version,
      createdAt: iso(r.created_at),
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      message: r.message,
    }));
  }
}
