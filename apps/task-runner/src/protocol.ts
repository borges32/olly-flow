import { z } from 'zod';

// O conteúdo dos itens é livre (dados do usuário); valida-se a estrutura da mensagem.
const expressionDataSchema = z.object({
  nodeName: z.string(),
  params: z.record(z.string(), z.unknown()),
  input: z.array(z.unknown()),
  nodes: z.record(z.string(), z.unknown()),
  paired: z.array(z.record(z.string(), z.unknown())),
  vars: z.record(z.string(), z.unknown()),
  env: z.record(z.string(), z.string()),
  execution: z.object({ id: z.string(), mode: z.enum(['test', 'production']) }),
  workflow: z.object({ id: z.string(), name: z.string(), active: z.boolean() }),
  timezone: z.string(),
});

export const requestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('evaluateBatch'),
    id: z.string(),
    executionId: z.string(),
    data: expressionDataSchema,
    requests: z.array(
      z.object({ id: z.string(), template: z.string(), itemIndex: z.number().int().min(0) }),
    ),
  }),
  z.object({ type: z.literal('disposeExecution'), id: z.string(), executionId: z.string() }),
  // Spec 005: nó de código JavaScript.
  z.object({
    type: z.literal('runCode'),
    id: z.string(),
    executionId: z.string(),
    code: z.string().max(1_000_000),
    mode: z.enum(['runOnceForAllItems', 'runOnceForEachItem']),
    data: expressionDataSchema,
  }),
]);
export type RunnerRequest = z.infer<typeof requestSchema>;

const evaluateResultSchema = z.union([
  z.object({ id: z.string(), ok: z.literal(true), value: z.unknown() }),
  z.object({
    id: z.string(),
    ok: z.literal(false),
    error: z.object({
      kind: z.enum(['syntax', 'runtime', 'timeout', 'memory']),
      message: z.string(),
    }),
  }),
]);

export const responseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('result'), id: z.string(), results: z.array(evaluateResultSchema) }),
  z.object({ type: z.literal('ack'), id: z.string() }),
  z.object({
    type: z.literal('codeResult'),
    id: z.string(),
    result: z.union([
      z.object({ ok: z.literal(true), result: z.unknown(), console: z.array(z.string()) }),
      z.object({
        ok: z.literal(false),
        error: z.object({
          kind: z.enum(['syntax', 'runtime', 'timeout', 'memory', 'crashed']),
          message: z.string(),
        }),
        console: z.array(z.string()),
      }),
    ]),
  }),
  z.object({ type: z.literal('error'), id: z.string().nullable(), message: z.string() }),
]);
export type RunnerResponse = z.infer<typeof responseSchema>;
