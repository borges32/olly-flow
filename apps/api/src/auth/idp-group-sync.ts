import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { RoleName } from '@olly/shared-types';
import { sql } from 'kysely';
import { AuditService } from '../audit/audit.service.js';
import { DB } from '../core/tokens.js';

export interface IdpMembership {
  projectId: string;
  role: RoleName;
}

/**
 * Sincroniza os vínculos herdados dos grupos do IdP (spec 009, FR-005; plan §2):
 * 1. calcula os vínculos esperados pelos mapeamentos dos grupos do token;
 * 2. insere os que faltam, ajusta o papel e remove os `idp` que não se aplicam mais;
 * 3. nunca toca nos vínculos `manual` (o ajuste do administrador prevalece).
 * Com vários grupos para o mesmo projeto, vale o papel com mais permissões.
 */
@Injectable()
export class IdpGroupSync {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async sync(userId: string, groups: string[]): Promise<IdpMembership[]> {
    return this.db.transaction().execute(async (trx) => {
      // Serializa sincronizações simultâneas do mesmo usuário (várias abas, várias instâncias).
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`idp-sync:${userId}`}))`.execute(trx);
      const mapped =
        groups.length === 0
          ? []
          : await trx
              .selectFrom('group_role_mappings as m')
              .innerJoin('roles as r', 'r.id', 'm.role_id')
              .select(['m.project_id', 'r.id as role_id', 'r.name', 'r.permissions'])
              .where('m.project_id', 'is not', null)
              .where('m.idp_group', 'in', groups)
              .execute();
      const expected = new Map<string, { roleId: number; name: string; weight: number }>();
      for (const m of mapped) {
        const projectId = m.project_id as string;
        const current = expected.get(projectId);
        if (!current || m.permissions.length > current.weight) {
          expected.set(projectId, {
            roleId: m.role_id,
            name: m.name,
            weight: m.permissions.length,
          });
        }
      }
      const existing = await trx
        .selectFrom('project_members')
        .select(['project_id', 'role_id', 'origin'])
        .where('user_id', '=', userId)
        .execute();
      const byProject = new Map(existing.map((e) => [e.project_id, e]));
      const added: string[] = [];
      const changed: string[] = [];
      const removed: string[] = [];
      for (const [projectId, role] of expected) {
        const current = byProject.get(projectId);
        if (!current) {
          await trx
            .insertInto('project_members')
            .values({ project_id: projectId, user_id: userId, role_id: role.roleId, origin: 'idp' })
            .execute();
          added.push(projectId);
        } else if (current.origin === 'idp' && current.role_id !== role.roleId) {
          await trx
            .updateTable('project_members')
            .set({ role_id: role.roleId })
            .where('project_id', '=', projectId)
            .where('user_id', '=', userId)
            .execute();
          changed.push(projectId);
        }
      }
      for (const e of existing) {
        if (e.origin === 'idp' && !expected.has(e.project_id)) {
          await trx
            .deleteFrom('project_members')
            .where('project_id', '=', e.project_id)
            .where('user_id', '=', userId)
            .where('origin', '=', 'idp')
            .execute();
          removed.push(e.project_id);
        }
      }
      if (added.length + changed.length + removed.length > 0) {
        await this.audit.record(
          trx,
          { userId, ip: null },
          {
            action: 'user.idp_sync',
            entityType: 'user',
            entityId: userId,
            details: { groups, added, changed, removed },
          },
        );
      }
      const result = await trx
        .selectFrom('project_members')
        .innerJoin('roles', 'roles.id', 'project_members.role_id')
        .select(['project_members.project_id', 'roles.name'])
        .where('project_members.user_id', '=', userId)
        .where('project_members.origin', '=', 'idp')
        .orderBy('project_members.project_id')
        .execute();
      return result.map((r) => ({ projectId: r.project_id, role: r.name as RoleName }));
    });
  }
}
