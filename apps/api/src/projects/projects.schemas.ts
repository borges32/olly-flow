import { ROLE_NAMES } from '@olly/shared-types';
import { z } from 'zod';

export const projectBodySchema = z.object({ name: z.string().trim().min(1).max(120) });
export const memberBodySchema = z.object({ role: z.enum(ROLE_NAMES) });
export const userSearchQuerySchema = z.object({ search: z.string().trim().max(120).optional() });
