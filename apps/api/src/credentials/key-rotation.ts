import { rewrapCredentialData, type Db, type KeyRing } from '@olly/db';
import type { AuditService } from '../audit/audit.service.js';

export interface RotationOptions {
  /** Migração (FR-003): só as credenciais deste provedor. Sem ele, rotação (FR-002). */
  from?: string;
  batchSize?: number;
  /** Progresso a cada lote (CLI). */
  onProgress?: (progress: RotationProgress) => void;
}

export interface RotationProgress {
  target: { provider: string; version: number };
  rewrapped: number;
  failed: number;
}

export interface RotationReport extends RotationProgress {
  errors: { credentialId: string; message: string }[];
}

const SYSTEM = { userId: null, ip: null };

/**
 * Rotação e migração da chave mestra (spec 009, FR-002, FR-003, NFR-001; plan §1): recifra a
 * DEK de cada credencial que ainda não está na chave atual, em lotes de 100. O checkpoint é a
 * própria credencial (`key_provider` + `key_version`): interrompida, a execução seguinte continua
 * de onde parou; repetida, não faz nada. A API segue no ar, pois o chaveiro dela decifra as duas
 * versões durante a troca. Cada lote é registrado na auditoria.
 */
export async function rotateCredentialKeys(
  db: Db,
  keys: KeyRing,
  audit: AuditService,
  options: RotationOptions = {},
): Promise<RotationReport> {
  const batchSize = options.batchSize ?? 100;
  const target = { provider: keys.current.id, version: await keys.current.currentKeyVersion() };
  const action = options.from ? 'credential.key.migrate' : 'credential.key.rotate';
  const report: RotationReport = { target, rewrapped: 0, failed: 0, errors: [] };
  await audit.record(db, SYSTEM, {
    action: `${action}.start`,
    entityType: 'system',
    entityId: 'credentials',
    details: { target, ...(options.from && { from: options.from }) },
  });

  let lastId = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const rows = await db
      .selectFrom('credentials')
      .select(['id', 'data_encrypted', 'key_provider', 'key_version'])
      .where('id', '>', lastId)
      .where((eb) =>
        eb.or([eb('key_provider', '!=', target.provider), eb('key_version', '!=', target.version)]),
      )
      .$if(options.from !== undefined, (qb) =>
        qb.where('key_provider', '=', options.from as string),
      )
      .orderBy('id')
      .limit(batchSize)
      .execute();
    if (rows.length === 0) break;
    let batchRewrapped = 0;
    for (const row of rows) {
      lastId = row.id;
      try {
        const next = await rewrapCredentialData(row.data_encrypted, keys);
        // Otimista: se a credencial foi editada no meio, ela já foi cifrada com a chave atual.
        const updated = await db
          .updateTable('credentials')
          .set({
            data_encrypted: next.blob,
            key_version: next.keyVersion,
            key_provider: next.keyProvider,
          })
          .where('id', '=', row.id)
          .where('data_encrypted', '=', row.data_encrypted)
          .executeTakeFirst();
        if (updated.numUpdatedRows > 0n) batchRewrapped++;
      } catch (error) {
        report.failed++;
        report.errors.push({
          credentialId: row.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    report.rewrapped += batchRewrapped;
    await audit.record(db, SYSTEM, {
      action: `${action}.progress`,
      entityType: 'system',
      entityId: 'credentials',
      details: { target, rewrapped: report.rewrapped, failed: report.failed, lastId },
    });
    options.onProgress?.({ target, rewrapped: report.rewrapped, failed: report.failed });
  }

  await audit.record(db, SYSTEM, {
    action: `${action}.finish`,
    entityType: 'system',
    entityId: 'credentials',
    details: {
      target,
      rewrapped: report.rewrapped,
      failed: report.failed,
      failedIds: report.errors.map((e) => e.credentialId),
    },
  });
  return report;
}
