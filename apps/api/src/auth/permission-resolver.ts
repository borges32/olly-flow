import { Inject, Injectable } from '@nestjs/common';
import type { Db, User } from '@olly/db';
import { PERMISSIONS, isPermission, type EffectivePermissions } from '@olly/shared-types';
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
 */
@Injectable()
export class ProjectPermissionResolver implements PermissionResolver {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async resolve(user: User, claims: AccessTokenClaims): Promise<ResolvedPermissions> {
    const isAdmin = (claims.groups ?? []).includes(this.config.oidc.adminGroup);
    const rows = await this.db
      .selectFrom('project_members')
      .innerJoin('roles', 'roles.id', 'project_members.role_id')
      .select(['project_members.project_id', 'roles.permissions'])
      .where('project_members.user_id', '=', user.id)
      .execute();
    const projects = Object.fromEntries(
      rows.map((r) => [r.project_id, r.permissions.filter(isPermission).sort()]),
    );
    return { isAdmin, permissions: { global: isAdmin ? [...PERMISSIONS].sort() : [], projects } };
  }
}
