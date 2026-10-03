/**
 * Catálogo de permissões (docs/arquitetura/contratos.md). Cada spec que introduz uma
 * permissão a acrescenta aqui e no seed de papéis.
 */
export const PERMISSIONS = [
  'user:manage',
  'project:manage',
  'workflow:create',
  'workflow:read',
  'workflow:update',
  'workflow:delete',
  'workflow:execute',
  'workflow:publish',
  'execution:read',
  'execution:readData',
  'credential:manage',
  'credential:use',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_NAMES = ['admin', 'editor', 'executor', 'viewer'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

const ADMIN_ONLY: readonly Permission[] = ['user:manage', 'project:manage', 'audit:read'];

/** Permissões padrão de cada papel (seed da spec 001, matriz da visão de produto). */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<RoleName, readonly Permission[]>> = {
  admin: PERMISSIONS,
  editor: PERMISSIONS.filter((p) => !ADMIN_ONLY.includes(p)),
  executor: ['workflow:read', 'workflow:execute', 'execution:read'],
  viewer: ['workflow:read', 'execution:read'],
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
