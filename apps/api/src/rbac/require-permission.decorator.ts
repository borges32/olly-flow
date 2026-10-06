import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@olly/shared-types';

export const REQUIRED_PERMISSION = 'olly:requiredPermission';

/** Recurso de projeto indicado por um parâmetro de rota: `{ workflow: 'id' }`. */
export type ResourceScope =
  | { project: string }
  | { workflow: string }
  | { execution: string }
  | { credential: string }
  | { publishRequest: string };

/**
 * Onde a permissão vale:
 * - `{ project | workflow | execution: 'param' }`: no projeto do recurso indicado pelo
 *   parâmetro de rota. Quem não é membro recebe 404 (FR-011 da spec 002);
 * - `'global'`: sem projeto (ex.: criar projeto);
 * - `'anyProject'`: em pelo menos um projeto.
 */
export type PermissionScope = ResourceScope | 'global' | 'anyProject';

export function resourceOf(scope: ResourceScope): {
  kind: 'project' | 'workflow' | 'execution' | 'credential' | 'publishRequest';
  param: string;
} {
  if ('publishRequest' in scope) return { kind: 'publishRequest', param: scope.publishRequest };
  if ('project' in scope) return { kind: 'project', param: scope.project };
  if ('workflow' in scope) return { kind: 'workflow', param: scope.workflow };
  if ('credential' in scope) return { kind: 'credential', param: scope.credential };
  return { kind: 'execution', param: scope.execution };
}

export interface PermissionRequirement {
  /** Basta uma delas. Vazio: só exige ser membro do projeto. */
  anyOf: Permission[];
  scope: PermissionScope;
}

/** Declara a permissão exigida pela rota (FR-012). */
export const RequirePermission = (permission: Permission | Permission[], scope: PermissionScope) =>
  SetMetadata(REQUIRED_PERMISSION, {
    anyOf: Array.isArray(permission) ? permission : [permission],
    scope,
  } satisfies PermissionRequirement);

/** Declara que a rota exige apenas ser membro do projeto (qualquer papel). */
export const RequireProjectMember = (param: string) =>
  SetMetadata(REQUIRED_PERMISSION, {
    anyOf: [],
    scope: { project: param },
  } satisfies PermissionRequirement);
