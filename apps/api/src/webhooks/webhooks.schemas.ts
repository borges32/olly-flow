import { workflowDefinitionShapeSchema } from '@olly/shared-types';
import { z } from 'zod';

export const publishSchema = z
  .object({ version: z.number().int().min(1).optional() })
  .nullish()
  .transform((v) => v ?? {});
export type PublishBody = z.infer<typeof publishSchema>;

export const listenSchema = z.object({
  definition: workflowDefinitionShapeSchema,
  /** Escuta pelo nó (spec 005, HU-2.1): a execução para neste nó de webhook. */
  destinationNodeId: z.string().min(1).optional(),
});
export type ListenBody = z.infer<typeof listenSchema>;
