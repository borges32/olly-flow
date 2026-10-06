import { Injectable } from '@nestjs/common';
import {
  AbilityBuilder,
  createMongoAbility,
  subject,
  type ForcedSubject,
  type MongoAbility,
} from '@casl/ability';
import type { Permission } from '@olly/shared-types';
import type { AuthenticatedUser } from '../auth/auth.types.js';

type ProjectSubject = ForcedSubject<'Project'> & { id: string };
export type AppAbility = MongoAbility<[Permission | 'manage', 'Project' | ProjectSubject | 'all']>;

/** Regras CASL do usuário (spec 002, plan §1). */
@Injectable()
export class AbilityFactory {
  forUser(user: AuthenticatedUser): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    if (user.isAdmin) {
      can('manage', 'all');
    } else {
      // Spec 009, FR-005: papel global herdado de grupo do IdP vale em todos os projetos.
      for (const permission of user.permissions.global) can(permission, 'Project');
      for (const [projectId, permissions] of Object.entries(user.permissions.projects)) {
        for (const permission of permissions) can(permission, 'Project', { id: projectId });
      }
    }
    return build();
  }
}

/** Pode no projeto informado. */
export function canInProject(
  ability: AppAbility,
  permission: Permission,
  projectId: string,
): boolean {
  return ability.can(permission, subject('Project', { id: projectId }));
}

/** Permissão no projeto sem montar as regras CASL (ex.: decisões dentro de um serviço). */
export function hasProjectPermission(
  user: AuthenticatedUser,
  permission: Permission,
  projectId: string,
): boolean {
  return (
    user.isAdmin ||
    user.permissions.global.includes(permission) ||
    (user.permissions.projects[projectId] ?? []).includes(permission)
  );
}

/** Enxerga todos os projetos: administrador ou papel global herdado de grupo (spec 009). */
export function seesAllProjects(user: AuthenticatedUser): boolean {
  return user.isAdmin || user.permissions.global.length > 0;
}

/** Pode em algum projeto (há ao menos uma regra para a permissão). */
export function canInAnyProject(ability: AppAbility, permission: Permission): boolean {
  return ability.can(permission, 'Project');
}

/** Pode sem restrição de projeto (regra sem condições, ex.: administrador global). */
export function canGlobally(ability: AppAbility, permission: Permission): boolean {
  return ability.rulesFor(permission, 'Project').some((rule) => !rule.inverted && !rule.conditions);
}
