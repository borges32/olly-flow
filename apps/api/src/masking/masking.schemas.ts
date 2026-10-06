import { MASKING_ACTIONS, MASKING_KINDS } from '@olly/shared-types';
import { maskingRuleProblem } from '@olly/engine';
import { z } from 'zod';

const rule = z.object({
  kind: z.enum(MASKING_KINDS),
  matcher: z.string().trim().min(1).max(200),
  action: z.enum(MASKING_ACTIONS),
  enabled: z.boolean().optional(),
  description: z.string().trim().max(200).nullable().optional(),
});

export const maskingRuleSchema = rule.superRefine((value, ctx) => {
  const problem = maskingRuleProblem(value);
  if (problem) ctx.addIssue({ code: 'custom', path: ['matcher'], message: problem });
});
export type MaskingRuleBody = z.infer<typeof maskingRuleSchema>;
