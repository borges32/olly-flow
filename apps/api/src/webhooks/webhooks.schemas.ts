import { workflowDefinitionShapeSchema } from '@olly/shared-types';
import { z } from 'zod';

/** Spec 009, FR-009: a mensagem é obrigatória ao publicar. */
export const publishSchema = z.object({
  version: z.number().int().min(1).optional(),
  message: z.string().trim().min(1, 'informe a mensagem da publicação').max(500),
});
export type PublishBody = z.infer<typeof publishSchema>;

export const listenSchema = z.object({
  definition: workflowDefinitionShapeSchema,
  /** Escuta pelo nó (spec 005, HU-2.1): a execução para neste nó de webhook. */
  destinationNodeId: z.string().min(1).optional(),
});
export type ListenBody = z.infer<typeof listenSchema>;
