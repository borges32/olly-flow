import type { EffectivePermissions, Permission } from '@olly/shared-types';

/**
 * Espelha a regra da API (spec 002, FR-010) para esconder ações não permitidas (NFR-002).
 * A autorização de verdade é sempre feita na API.
 */
export function can(
  perms: EffectivePermissions | undefined,
  permission: Permission,
  projectId?: string,
): boolean {
  if (!perms) return false;
  if (perms.global.includes(permission)) return true;
  if (projectId === undefined) return false;
  return perms.projects[projectId]?.includes(permission) ?? false;
}

/** Tem a permissão em algum projeto (ou globalmente). */
export function canAnywhere(
  perms: EffectivePermissions | undefined,
  permission: Permission,
): boolean {
  if (!perms) return false;
  return (
    perms.global.includes(permission) ||
    Object.values(perms.projects).some((p) => p.includes(permission))
  );
}
