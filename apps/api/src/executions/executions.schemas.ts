import { itemSchema, workflowDefinitionInputSchema } from '@olly/shared-types';
import { z } from 'zod';

export const testRunSchema = z.object({
  definition: workflowDefinitionInputSchema,
  pinData: z.record(z.string(), z.array(itemSchema)).optional(),
  destinationNodeId: z.string().min(1).optional(),
  reuse: z.record(z.string().min(1), z.uuid()).optional(),
});
export type TestRunBody = z.infer<typeof testRunSchema>;

export const previewSchema = z.object({
  definition: workflowDefinitionInputSchema,
  nodeId: z.string().min(1),
  expression: z.string().max(10_000),
  executionId: z.uuid().optional(),
  itemIndex: z.number().int().min(0).optional(),
});
export type PreviewBody = z.infer<typeof previewSchema>;

export const joinSchema = z.object({ executionId: z.uuid(), metadataOnly: z.boolean().optional() });

export const joinWorkflowSchema = z.object({ workflowId: z.uuid() });

const EXECUTION_STATUSES = [
  'queued',
  'running',
  'waiting',
  'success',
  'error',
  'cancelled',
] as const;

/** `GET /executions` (spec 005, FR-013). */
export const listExecutionsQuerySchema = z.object({
  projectId: z.uuid().optional(),
  workflowId: z.uuid().optional(),
  /** Spec 029, FR-015: um status ou uma lista separada por vírgulas (`queued,running,waiting`). */
  status: z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim()))
    .pipe(z.array(z.enum(EXECUTION_STATUSES)).min(1).max(EXECUTION_STATUSES.length))
    .optional(),
  mode: z.enum(['test', 'production']).optional(),
  trigger: z.string().min(1).max(50).optional(),
  userId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListExecutionsQuery = z.infer<typeof listExecutionsQuerySchema>;

/** `GET /executions/:id/steps` (spec 029): sem `limit`, todos os passos. */
export const stepsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type StepsQuery = z.infer<typeof stepsQuerySchema>;
