import {
  OLLY_CHAT_AUTH_TYPES,
  OLLY_CHAT_MAX_MESSAGE_CHARS,
  OLLY_CHAT_MAX_TITLE_CHARS,
  OLLY_CHAT_RETENTION,
} from '@olly/shared-types';
import { z } from 'zod';

/** Spec 028, FR-004: o navegador manda só o texto; a identidade vem do servidor. */
export const ollyChatMessageSchema = z.object({
  message: z.string().trim().min(1).max(OLLY_CHAT_MAX_MESSAGE_CHARS),
});
export type OllyChatMessageBody = z.infer<typeof ollyChatMessageSchema>;

export const ollyChatRenameSchema = z.object({
  title: z.string().trim().min(1).max(OLLY_CHAT_MAX_TITLE_CHARS),
});
export type OllyChatRenameBody = z.infer<typeof ollyChatRenameSchema>;

const secret = z.string().max(4096).optional();

/** Spec 028, FR-008: URL HTTP(S), retenção dentro dos limites e autenticação opcional. */
export const ollyChatConfigSchema = z.object({
  webhookUrl: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .nullable(),
  retentionDays: z.number().int().min(OLLY_CHAT_RETENTION.min).max(OLLY_CHAT_RETENTION.max),
  authType: z.enum(OLLY_CHAT_AUTH_TYPES),
  headerName: z
    .string()
    .trim()
    .max(200)
    .regex(/^[A-Za-z0-9-]*$/, 'nome de cabeçalho inválido')
    .optional(),
  headerValue: secret,
  basicUser: z.string().trim().max(200).optional(),
  basicPassword: secret,
});
