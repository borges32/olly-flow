import { Inject, Injectable } from '@nestjs/common';
import type { Db, User } from '@olly/db';
import { isPermission, type Permission } from '@olly/shared-types';
import { DB } from '../core/tokens.js';
import type { AccessTokenClaims } from './auth.types.js';

/** Calcula as permissões efetivas do usuário autenticado. */
export interface PermissionResolver {
  resolve(user: User, claims: AccessTokenClaims): Promise<Permission[]>;
}

export const PERMISSION_RESOLVER = Symbol('PERMISSION_RESOLVER');

const ROLES_TTL_MS = 60_000;

/**
 * Implementação da spec 001: cada grupo do claim `groups` com o nome de um papel concede as
 * permissões desse papel globalmente. A spec 002 a substitui pelo RBAC por projeto.
 */
@Injectable()
export class GroupPermissionResolver implements PermissionResolver {
  private roles?: { byName: Map<string, Permission[]>; expiresAt: number };

  constructor(@Inject(DB) private readonly db: Db) {}

  async resolve(_user: User, claims: AccessTokenClaims): Promise<Permission[]> {
    const byName = await this.loadRoles();
    const permissions = new Set<Permission>();
    for (const group of claims.groups ?? []) {
      for (const permission of byName.get(group) ?? []) permissions.add(permission);
    }
    return [...permissions].sort();
  }

  private async loadRoles(): Promise<Map<string, Permission[]>> {
    if (this.roles && this.roles.expiresAt > Date.now()) return this.roles.byName;
    const rows = await this.db.selectFrom('roles').select(['name', 'permissions']).execute();
    const byName = new Map(rows.map((r) => [r.name, r.permissions.filter(isPermission)]));
    this.roles = { byName, expiresAt: Date.now() + ROLES_TTL_MS };
    return byName;
  }
}
