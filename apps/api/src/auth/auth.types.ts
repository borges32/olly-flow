import type { EffectivePermissions } from '@olly/shared-types';
import { z } from 'zod';

export const accessTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().optional(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
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
  /** Membro do grupo de administração global do IdP. */
  isAdmin: boolean;
  permissions: EffectivePermissions;
}
