import { Inject, Injectable } from '@nestjs/common';
import type { Db, User } from '@olly/db';
import {
  PERMISSIONS,
  isPermission,
  type EffectivePermissions,
  type Permission,
} from '@olly/shared-types';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import type { AccessTokenClaims } from './auth.types.js';

export interface ResolvedPermissions {
  isAdmin: boolean;
  permissions: EffectivePermissions;
}

/** Calcula as permissões efetivas do usuário autenticado. */
export interface PermissionResolver {
  resolve(user: User, claims: AccessTokenClaims): Promise<ResolvedPermissions>;
}

export const PERMISSION_RESOLVER = Symbol('PERMISSION_RESOLVER');

/**
 * RBAC por projeto (spec 002, FR-010): o grupo de administração do IdP concede todas as
 * permissões em todos os projetos; os demais usuários têm as permissões do seu papel
 * somente nos projetos dos quais são membros. Substitui o resolver por grupo da spec 001.
 *
 * Spec 009:
 * - grupos do IdP mapeados para um papel global (`group_role_mappings` sem projeto) dão as
 *   permissões do papel em todos os projetos, enquanto o usuário estiver no grupo (FR-005);
 * - com `executor_can_read_data` no projeto, o papel Executor ganha `execution:readData` (FR-019).
 */
@Injectable()
export class ProjectPermissionResolver implements PermissionResolver {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async resolve(user: User, claims: AccessTokenClaims): Promise<ResolvedPermissions> {
    const groups = claims.groups ?? [];
    // Spec 014 (FR-003): administração global da plataforma (`is_admin`) ou, com o IdP ligado,
    // o grupo de administração do IdP.
    const isAdmin =
      user.is_admin || (this.config.oidc ? groups.includes(this.config.oidc.adminGroup) : false);
    if (isAdmin) {
      return {
        isAdmin,
        permissions: { global: [...PERMISSIONS].sort(), projects: await this.projects(user) },
      };
    }
    const [projects, global] = await Promise.all([this.projects(user), this.globalRoles(groups)]);
    return { isAdmin, permissions: { global, projects } };
  }

  private async projects(user: User): Promise<Record<string, Permission[]>> {
    const rows = await this.db
      .selectFrom('project_members')
      .innerJoin('roles', 'roles.id', 'project_members.role_id')
      .innerJoin('projects', 'projects.id', 'project_members.project_id')
      .select([
        'project_members.project_id',
        'roles.name',
        'roles.permissions',
        'projects.executor_can_read_data',
      ])
      .where('project_members.user_id', '=', user.id)
      .execute();
    return Object.fromEntries(
      rows.map((r) => {
        const permissions = new Set(r.permissions.filter(isPermission));
        if (r.name === 'executor' && r.executor_can_read_data)
          permissions.add('execution:readData');
        return [r.project_id, [...permissions].sort()];
      }),
    );
  }

  private async globalRoles(groups: string[]): Promise<Permission[]> {
    if (groups.length === 0) return [];
    const rows = await this.db
      .selectFrom('group_role_mappings')
      .innerJoin('roles', 'roles.id', 'group_role_mappings.role_id')
      .select('roles.permissions')
      .where('group_role_mappings.project_id', 'is', null)
      .where('group_role_mappings.idp_group', 'in', groups)
      .execute();
    return [...new Set(rows.flatMap((r) => r.permissions.filter(isPermission)))].sort();
  }
}
