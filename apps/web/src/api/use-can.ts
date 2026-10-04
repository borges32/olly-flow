import type { Permission } from '@olly/shared-types';
import { can, canAnywhere } from '@/lib/permissions';
import { useMe } from './use-me';

/** Condiciona a UI às permissões do usuário (plan §8). */
export function useCan(permission: Permission, projectId?: string): boolean {
  return can(useMe().data?.permissions, permission, projectId);
}

export function useCanAnywhere(permission: Permission): boolean {
  return canAnywhere(useMe().data?.permissions, permission);
}
