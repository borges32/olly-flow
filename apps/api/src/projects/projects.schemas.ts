import { ROLE_NAMES, SAVE_EXECUTION_DATA } from '@olly/shared-types';
import { z } from 'zod';

export const projectBodySchema = z.object({ name: z.string().trim().min(1).max(120) });
export const memberBodySchema = z.object({ role: z.enum(ROLE_NAMES) });
export const userSearchQuerySchema = z.object({ search: z.string().trim().max(120).optional() });
/** Spec 006, FR-012: `null` volta à cota padrão da plataforma. */
export const quotaBodySchema = z.object({
  maxConcurrentExecutions: z.number().int().min(1).max(10_000).nullable(),
});

const days = z.number().int().min(1).max(36_500).nullable();
/** Spec 009: governança do projeto (FR-011, FR-012, FR-017, FR-019). */
export const projectSettingsSchema = z
  .object({
    requirePublishApproval: z.boolean().optional(),
    executorCanReadData: z.boolean().optional(),
    saveExecutionData: z.enum(SAVE_EXECUTION_DATA).optional(),
    retention: z.object({ dataDays: days.optional(), metadataDays: days.optional() }).optional(),
  })
  .strict();
