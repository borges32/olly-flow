import { z } from 'zod';

const name = z.string().trim().min(1).max(200);
const data = z.record(z.string().min(1).max(100), z.unknown());

export const createCredentialSchema = z.object({ name, type: z.string().min(1).max(100), data });
export type CreateCredentialBody = z.infer<typeof createCredentialSchema>;

export const updateCredentialSchema = z.object({ name: name.optional(), data: data.optional() });
export type UpdateCredentialBody = z.infer<typeof updateCredentialSchema>;

// POST sem corpo também é aceito (tipos que não precisam de URL).
export const testCredentialSchema = z
  .object({ url: z.url({ protocol: /^https?$/ }).optional() })
  .nullish()
  .transform((v) => v ?? {});
export type TestCredentialBody = z.infer<typeof testCredentialSchema>;

const identifier = z.string().min(1).max(63);
export const tablesQuerySchema = z.object({ schema: identifier });
export const columnsQuerySchema = z.object({ schema: identifier, table: identifier });
