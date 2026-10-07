import type { EffectivePermissions } from '@olly/shared-types';
import { z } from 'zod';

export const accessTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().optional(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
  // Spec 014 (FR-015): só e-mail verificado pelo IdP vincula a um usuário local.
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  // Lida de fato pelo `GroupResolver` (claim configurável, spec 009).
  groups: z.unknown().optional(),
});
export type AccessTokenClaims = Omit<z.infer<typeof accessTokenClaimsSchema>, 'groups'> & {
  groups?: string[];
};

export interface AuthenticatedUser {
  id: string;
  externalId: string;
  email: string;
  name: string | null;
  /** Administração global: `users.is_admin` ou o grupo de administração do IdP (spec 014). */
  isAdmin: boolean;
  permissions: EffectivePermissions;
  /** Spec 014: como a sessão foi aberta; a sessão local tem id (sair, troca de senha). */
  authMethod: 'local' | 'idp';
  sessionId?: string;
  /** Spec 014 (FR-007): sessão local com troca de senha pendente. */
  mustChangePassword: boolean;
}
