import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NotFoundError, PermissionDeniedError, UnauthenticatedError } from '../common/errors.js';
import type { RequestWithUser } from '../auth/current-user.decorator.js';
import { AbilityFactory, canGlobally, canInAnyProject, canInProject } from './ability.factory.js';
import {
  REQUIRED_PERMISSION,
  resourceOf,
  type PermissionRequirement,
} from './require-permission.decorator.js';
import { ResourceResolver } from './resource-resolver.js';

/**
 * Aplica `@RequirePermission` (FR-010/FR-011). Roda depois do `AuthGuard`. Recurso de projeto
 * do qual o usuário não é membro responde 404, para não revelar que existe.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AbilityFactory) private readonly abilities: AbilityFactory,
    @Inject(ResourceResolver) private readonly resources: ResourceResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) throw new UnauthenticatedError('Usuário não autenticado');
    const ability = this.abilities.forUser(user);
    const { anyOf, scope } = requirement;

    if (scope === 'global' || scope === 'anyProject') {
      const check = scope === 'global' ? canGlobally : canInAnyProject;
      if (anyOf.some((p) => check(ability, p))) return true;
      throw new PermissionDeniedError('Acesso negado');
    }

    const { kind, param } = resourceOf(scope);
    const value = (request.params as Record<string, unknown>)[param];
    const projectId = await this.resources.projectIdFor(
      kind,
      typeof value === 'string' ? value : '',
    );
    const isMember = projectId !== null && (user.isAdmin || projectId in user.permissions.projects);
    if (!projectId || !isMember) throw new NotFoundError('Recurso não encontrado');

    request.projectId = projectId;
    if (anyOf.length === 0 || anyOf.some((p) => canInProject(ability, p, projectId))) return true;
    throw new PermissionDeniedError('Acesso negado');
  }
}
