import { workflowDefinitionShapeSchema } from '@olly/shared-types';
import { z } from 'zod';

/**
 * Spec 015: `content` é o texto do arquivo ou o JSON já interpretado. A estrutura é verificada
 * pela conversão (conteúdo não confiável, FR-018), não aqui.
 */
export const importBodySchema = z.object({
  format: z.enum(['olly', 'n8n']).default('olly'),
  content: z
    .unknown()
    .refine((v) => v !== undefined && v !== null, 'Informe o conteúdo do arquivo'),
  name: z.string().trim().min(1).max(200).optional(),
});

export const exportBodySchema = z.object({
  definition: workflowDefinitionShapeSchema,
  name: z.string().trim().min(1).max(200).optional(),
});

export type ImportBody = z.infer<typeof importBodySchema>;
export type ExportBody = z.infer<typeof exportBodySchema>;
