import { MCP_TRANSPORTS } from '@olly/shared-types';
import { z } from 'zod';

const transport = z.string().superRefine((value, ctx) => {
  if (value === 'stdio') {
    // FR-005: nesta versão o cliente MCP só faz chamadas via HTTP.
    ctx.addIssue({
      code: 'custom',
      message: 'O transporte stdio não é suportado nesta versão: use Streamable HTTP ou SSE',
    });
  } else if (!(MCP_TRANSPORTS as readonly string[]).includes(value)) {
    ctx.addIssue({ code: 'custom', message: `Transporte desconhecido: ${value}` });
  }
});

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Informe uma URL http(s) válida');

export const mcpServerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  transport: transport.transform((v) => v as (typeof MCP_TRANSPORTS)[number]),
  url: httpUrl,
  credentialId: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
});
export type McpServerBody = z.infer<typeof mcpServerSchema>;

export const mcpPoliciesSchema = z.object({
  projectId: z.uuid().nullable().optional(),
  policies: z
    .array(
      z.object({
        toolName: z.string().trim().min(1).max(200),
        allowed: z.boolean(),
        destructive: z.boolean(),
      }),
    )
    .max(1000),
});
export type McpPoliciesBody = z.infer<typeof mcpPoliciesSchema>;

export const mcpToolsQuerySchema = z.object({ projectId: z.uuid().optional() });
export const mcpListQuerySchema = z.object({ projectId: z.uuid().optional() });

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1).max(4000).optional(),
  state: z.string().min(1).max(200),
  error: z.string().max(200).optional(),
  error_description: z.string().max(1000).optional(),
});
