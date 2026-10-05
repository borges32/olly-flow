import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { ProjectMember, ProjectSummary, RoleName, UserSummary } from '@olly/shared-types';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ConflictError, NotFoundError } from '../common/errors.js';
import { DB } from '../core/tokens.js';

const iso = (d: Date) => d.toISOString();

/** Projetos e membros (spec 002, FR-013), com auditoria de toda mudança (FR-014). */
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Administrador global vê todos; os demais, só os projetos dos quais são membros. */
  async list(user: AuthenticatedUser): Promise<ProjectSummary[]> {
    const rows = await this.db
      .selectFrom('projects')
      .leftJoin('project_members', (join) =>
        join
          .onRef('project_members.project_id', '=', 'projects.id')
          .on('project_members.user_id', '=', user.id),
      )
      .leftJoin('roles', 'roles.id', 'project_members.role_id')
      .select(['projects.id', 'projects.name', 'projects.created_at', 'roles.name as role'])
      .$if(!user.isAdmin, (qb) => qb.where('project_members.user_id', '=', user.id))
      .orderBy('projects.name')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: iso(r.created_at),
      role: (r.role as RoleName | null) ?? null,
    }));
  }

  async get(user: AuthenticatedUser, projectId: string): Promise<ProjectSummary> {
    const project = (await this.list(user)).find((p) => p.id === projectId);
    if (!project) throw new NotFoundError('Projeto não encontrado');
    return project;
  }

  async create(ctx: AuditContext, name: string): Promise<ProjectSummary> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('projects')
        .values({ name })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, ctx, {
        action: 'project.create',
        entityType: 'project',
        entityId: row.id,
        details: { name },
      });
      return { id: row.id, name: row.name, createdAt: iso(row.created_at), role: null };
    });
  }

  async rename(ctx: AuditContext, projectId: string, name: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('projects')
        .select('name')
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();
      await trx.updateTable('projects').set({ name }).where('id', '=', projectId).execute();
      await this.audit.record(trx, ctx, {
        action: 'project.update',
        entityType: 'project',
        entityId: projectId,
        details: { from: before.name, to: name },
      });
    });
  }

  /** Spec 006, FR-012: cota de execuções simultâneas (`null`: padrão da plataforma). */
  async setQuota(ctx: AuditContext, projectId: string, limit: number | null): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('projects')
        .select('max_concurrent_executions')
        .where('id', '=', projectId)
        .executeTakeFirst();
      if (!before) throw new NotFoundError('Projeto não encontrado');
      await trx
        .updateTable('projects')
        .set({ max_concurrent_executions: limit })
        .where('id', '=', projectId)
        .execute();
      await this.audit.record(trx, ctx, {
        action: 'project.quota',
        entityType: 'project',
        entityId: projectId,
        details: { from: before.max_concurrent_executions, to: limit },
      });
    });
  }

  /** Projetos com workflows (mesmo excluídos) não podem ser apagados: o histórico precisa ficar. */
  async delete(ctx: AuditContext, projectId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const workflow = await trx
        .selectFrom('workflows')
        .select('id')
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (workflow) throw new ConflictError('O projeto possui workflows e não pode ser excluído');
      const project = await trx
        .deleteFrom('projects')
        .where('id', '=', projectId)
        .returning('name')
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, ctx, {
        action: 'project.delete',
        entityType: 'project',
        entityId: projectId,
        details: { name: project.name },
      });
    });
  }

  async members(projectId: string): Promise<ProjectMember[]> {
    const rows = await this.db
      .selectFrom('project_members')
      .innerJoin('users', 'users.id', 'project_members.user_id')
      .innerJoin('roles', 'roles.id', 'project_members.role_id')
      .select([
        'users.id',
        'users.email',
        'users.name',
        'roles.name as role',
        'project_members.created_at',
      ])
      .where('project_members.project_id', '=', projectId)
      .orderBy('users.email')
      .execute();
    return rows.map((r) => ({
      userId: r.id,
      email: r.email,
      name: r.name,
      role: r.role as RoleName,
      createdAt: iso(r.created_at),
    }));
  }

  async setMember(
    ctx: AuditContext,
    projectId: string,
    userId: string,
    role: RoleName,
  ): Promise<ProjectMember> {
    await this.db.transaction().execute(async (trx) => {
      const user = await trx
        .selectFrom('users')
        .select('id')
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!user) throw new NotFoundError('Usuário não encontrado');
      const { id: roleId } = await trx
        .selectFrom('roles')
        .select('id')
        .where('name', '=', role)
        .executeTakeFirstOrThrow();
      const previous = await trx
        .selectFrom('project_members')
        .innerJoin('roles', 'roles.id', 'project_members.role_id')
        .select('roles.name')
        .where('project_id', '=', projectId)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      await trx
        .insertInto('project_members')
        .values({ project_id: projectId, user_id: userId, role_id: roleId })
        .onConflict((oc) => oc.columns(['project_id', 'user_id']).doUpdateSet({ role_id: roleId }))
        .execute();
      await this.audit.record(trx, ctx, {
        action: 'project.member.set',
        entityType: 'project',
        entityId: projectId,
        details: { userId, role, previousRole: previous?.name ?? null },
      });
    });
    const member = (await this.members(projectId)).find((m) => m.userId === userId);
    if (!member) throw new NotFoundError('Membro não encontrado');
    return member;
  }

  async removeMember(ctx: AuditContext, projectId: string, userId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const removed = await trx
        .deleteFrom('project_members')
        .where('project_id', '=', projectId)
        .where('user_id', '=', userId)
        .returning('role_id')
        .executeTakeFirst();
      if (!removed) throw new NotFoundError('Membro não encontrado');
      await this.audit.record(trx, ctx, {
        action: 'project.member.remove',
        entityType: 'project',
        entityId: projectId,
        details: { userId },
      });
    });
  }

  async searchUsers(search?: string): Promise<UserSummary[]> {
    const term = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
    const rows = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'name'])
      .where('is_active', '=', true)
      .$if(term !== undefined, (qb) =>
        qb.where((eb) =>
          eb.or([eb('email', 'ilike', term as string), eb('name', 'ilike', term as string)]),
        ),
      )
      .orderBy('email')
      .limit(20)
      .execute();
    return rows;
  }
}
