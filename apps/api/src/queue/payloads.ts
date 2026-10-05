import type { Db } from '@olly/db';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';
import type { ExecutionPayload } from '../executions/execution-job.js';

/** Acima disto o payload vai para o object storage (spec 006, plan §1). */
export const PAYLOAD_INLINE_MAX_BYTES = 1024 * 1024;

/**
 * Grava os dados do disparo fora da fila (FR-001): no banco ou, acima de 1 MB e com object
 * storage configurado, no MinIO/S3 (fica só a referência).
 */
export async function savePayload(
  db: Db,
  storage: S3BinaryStorage | null,
  executionId: string,
  payload: ExecutionPayload,
): Promise<void> {
  const raw = JSON.stringify(payload);
  const bytes = Buffer.byteLength(raw);
  if (bytes > PAYLOAD_INLINE_MAX_BYTES && storage) {
    const ref = await storage.put(`payloads/${executionId}.json`, Buffer.from(raw), {
      mimeType: 'application/json',
    });
    await db
      .insertInto('execution_payloads')
      .values({ execution_id: executionId, data_ref: ref.id })
      .execute();
    return;
  }
  await db
    .insertInto('execution_payloads')
    .values({ execution_id: executionId, data: raw })
    .execute();
}

export async function loadPayload(
  db: Db,
  storage: S3BinaryStorage | null,
  executionId: string,
): Promise<ExecutionPayload> {
  const row = await db
    .selectFrom('execution_payloads')
    .select(['data', 'data_ref'])
    .where('execution_id', '=', executionId)
    .executeTakeFirst();
  if (!row) return {};
  if (row.data_ref) {
    if (!storage) throw new Error('Payload no object storage, mas o S3 não está configurado');
    const bytes = await storage.get({ id: row.data_ref, mimeType: 'application/json' });
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as ExecutionPayload;
  }
  return row.data ?? {};
}
