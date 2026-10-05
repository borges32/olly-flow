import type { Db } from '@olly/db';
import type { BinaryRef } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import type { S3BinaryStorage } from '../binary/s3-binary-store.js';
import { PAYLOAD_INLINE_MAX_BYTES, loadPayload, savePayload } from './payloads.js';

/** Banco falso com a tabela `execution_payloads` em memória. */
function fakeDb() {
  const rows = new Map<string, { data: unknown; data_ref: string | null }>();
  const db = {
    insertInto: () => ({
      values: (v: { execution_id: string; data?: string; data_ref?: string }) => ({
        execute: () => {
          rows.set(v.execution_id, {
            data: v.data ? (JSON.parse(v.data) as unknown) : null,
            data_ref: v.data_ref ?? null,
          });
          return Promise.resolve();
        },
      }),
    }),
    selectFrom: () => ({
      select: () => ({
        where: (_c: string, _o: string, id: string) => ({
          executeTakeFirst: () => Promise.resolve(rows.get(id)),
        }),
      }),
    }),
  } as unknown as Db;
  return { db, rows };
}

function fakeStorage() {
  const objects = new Map<string, Uint8Array>();
  const storage = {
    put: (id: string, data: Uint8Array, meta: Omit<BinaryRef, 'id' | 'size'>) => {
      objects.set(id, data);
      return Promise.resolve({ id, size: data.byteLength, ...meta });
    },
    get: (ref: BinaryRef) => Promise.resolve(objects.get(ref.id) ?? new Uint8Array()),
  } as unknown as S3BinaryStorage;
  return { storage, objects };
}

describe('spec 006 — FR-001: payload do disparo fora da fila', () => {
  it('FR-001: payload pequeno fica no banco', async () => {
    const { db, rows } = fakeDb();
    const { storage, objects } = fakeStorage();
    const payload = { triggerItems: [{ json: { nome: 'Ana' } }], startNodeId: 'w' };
    await savePayload(db, storage, 'e1', payload);
    expect(rows.get('e1')).toEqual({ data: payload, data_ref: null });
    expect(objects.size).toBe(0);
    expect(await loadPayload(db, storage, 'e1')).toEqual(payload);
  });

  it('FR-001: acima de 1 MB vai para o object storage e o banco guarda só a referência', async () => {
    const { db, rows } = fakeDb();
    const { storage, objects } = fakeStorage();
    const payload = { triggerItems: [{ json: { texto: 'x'.repeat(PAYLOAD_INLINE_MAX_BYTES) } }] };
    await savePayload(db, storage, 'e2', payload);
    expect(rows.get('e2')).toEqual({ data: null, data_ref: 'payloads/e2.json' });
    expect(objects.has('payloads/e2.json')).toBe(true);
    expect(await loadPayload(db, storage, 'e2')).toEqual(payload);
  });

  it('FR-001: sem object storage configurado, fica no banco mesmo grande', async () => {
    const { db, rows } = fakeDb();
    const payload = { triggerItems: [{ json: { texto: 'x'.repeat(PAYLOAD_INLINE_MAX_BYTES) } }] };
    await savePayload(db, null, 'e3', payload);
    expect(rows.get('e3')?.data_ref).toBeNull();
    expect(await loadPayload(db, null, 'e3')).toEqual(payload);
  });
});
