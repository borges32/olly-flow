import { APPROVAL_STATUSES } from '@olly/shared-types';
import { z } from 'zod';

export const aiPricingSchema = z.object({
  provider: z.string().trim().min(1).max(50),
  inputPer1m: z.number().min(0).max(100_000),
  outputPer1m: z.number().min(0).max(100_000),
  currency: z.string().trim().length(3).optional(),
  note: z.string().trim().max(300).nullable().optional(),
});
export type AiPricingBody = z.infer<typeof aiPricingSchema>;

/** Nome do modelo no caminho (`PUT|DELETE /ai-models/:model`). */
export const aiModelNameSchema = z.string().trim().min(1).max(200);

export const aiModelSchema = z.object({
  note: z.string().trim().max(300).nullable().optional(),
});
export type AiModelBody = z.infer<typeof aiModelSchema>;

export const aiSettingsSchema = z.object({
  allowedModels: z.array(z.string().trim().min(1).max(200)).max(200).nullable(),
  monthlyTokenLimit: z.number().int().positive().max(1e15).nullable(),
});
export type AiSettingsBody = z.infer<typeof aiSettingsSchema>;

export const usageQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const approvalsQuerySchema = z.object({
  status: z.enum(APPROVAL_STATUSES).optional(),
  executionId: z.uuid().optional(),
});

export const approvalDecisionSchema = z.object({
  comment: z.string().trim().max(2000).optional(),
});
