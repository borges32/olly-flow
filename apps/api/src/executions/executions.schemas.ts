import { itemSchema, workflowDefinitionShapeSchema } from '@olly/shared-types';
import { z } from 'zod';

export const testRunSchema = z.object({
  definition: workflowDefinitionShapeSchema,
  pinData: z.record(z.string(), z.array(itemSchema)).optional(),
  destinationNodeId: z.string().min(1).optional(),
});
export type TestRunBody = z.infer<typeof testRunSchema>;

export const previewSchema = z.object({
  definition: workflowDefinitionShapeSchema,
  nodeId: z.string().min(1),
  expression: z.string().max(10_000),
  executionId: z.uuid().optional(),
  itemIndex: z.number().int().min(0).optional(),
});
export type PreviewBody = z.infer<typeof previewSchema>;

export const joinSchema = z.object({ executionId: z.uuid() });

export const joinWorkflowSchema = z.object({ workflowId: z.uuid() });
