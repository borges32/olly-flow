import { itemSchema, workflowDefinitionInputSchema } from '@olly/shared-types';
import { z } from 'zod';

/** Mensagem do painel de chat do editor (spec 021, FR-002): definição atual, sessão e texto. */
export const chatTestSchema = z.object({
  definition: workflowDefinitionInputSchema,
  sessionId: z.string().min(1).max(200),
  chatInput: z.string().max(1_000_000),
  pinData: z.record(z.string(), z.array(itemSchema)).optional(),
});
export type ChatTestBody = z.infer<typeof chatTestSchema>;
