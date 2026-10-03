import type { Permission } from '@olly/shared-types';
import { z } from 'zod';

export const accessTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().optional(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
  groups: z.array(z.string()).optional(),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

export interface AuthenticatedUser {
  id: string;
  externalId: string;
  email: string;
  name: string | null;
  permissions: Permission[];
}
