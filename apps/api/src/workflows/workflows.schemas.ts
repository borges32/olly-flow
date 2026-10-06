import { workflowDefinitionShapeSchema } from '@olly/shared-types';
import { z } from 'zod';

const name = z.string().trim().min(1).max(200);

export const createWorkflowSchema = z.object({
  name,
  definition: workflowDefinitionShapeSchema.optional(),
});

/** Spec 009, FR-009: mensagem opcional ao salvar, obrigatória ao publicar. */
export const versionMessage = z.string().trim().min(1).max(500);

export const saveWorkflowSchema = z.object({
  name: name.optional(),
  definition: workflowDefinitionShapeSchema,
  baseVersion: z.number().int().min(1),
  message: versionMessage.optional(),
});

export const diffQuerySchema = z.object({
  from: z.coerce.number().int().min(1),
  /** Padrão: a versão atual. */
  to: z.coerce.number().int().min(1).optional(),
});

export const restoreSchema = z
  .object({ message: versionMessage.optional() })
  .nullish()
  .transform((v) => v ?? {});

export const listWorkflowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});

export type CreateWorkflowBody = z.infer<typeof createWorkflowSchema>;
export type SaveWorkflowBody = z.infer<typeof saveWorkflowSchema>;
export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuerySchema>;
export type DiffQuery = z.infer<typeof diffQuerySchema>;
export type RestoreBody = z.infer<typeof restoreSchema>;
