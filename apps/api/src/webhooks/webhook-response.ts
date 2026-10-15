import type { WebhookResponse } from '@olly/nodes';
import type { FastifyReply } from 'fastify';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';

/** Resposta do nó "Responder ao webhook" (spec 005, FR-008), também usada pelo chat (spec 021). */
export async function sendWebhookResponse(
  reply: FastifyReply,
  response: WebhookResponse,
  executionId: string,
  binaries: S3BinaryStorage | null,
): Promise<void> {
  void reply.code(response.statusCode);
  for (const [name, value] of Object.entries(response.headers)) void reply.header(name, value);
  const body = response.body;
  if (!body) {
    await reply.send();
    return;
  }
  if (body.kind === 'json') {
    if (!reply.hasHeader('content-type'))
      void reply.header('content-type', 'application/json; charset=utf-8');
    await reply.send(JSON.stringify(body.value ?? null));
    return;
  }
  if (body.kind === 'text') {
    if (!reply.hasHeader('content-type'))
      void reply.header('content-type', 'text/plain; charset=utf-8');
    await reply.send(body.value);
    return;
  }
  if (!binaries) {
    await reply
      .code(500)
      .send({ message: 'Armazenamento de binários não configurado', executionId });
    return;
  }
  const data = await binaries.get(body.ref);
  if (!reply.hasHeader('content-type')) void reply.header('content-type', body.ref.mimeType);
  await reply.send(Buffer.from(data));
}
