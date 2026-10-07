import { randomBytes } from 'node:crypto';
import type { Db } from '@olly/db';
import { sql } from 'kysely';
import type { AuditService } from '../audit/audit.service.js';
import { normalizeEmail } from './local-auth.service.js';
import { hashPassword } from './password.js';

export interface RecoveryResult {
  userId: string;
  created: boolean;
  /** Senha temporária, mostrada uma única vez; troca obrigatória no primeiro acesso. */
  temporaryPassword: string;
}

/**
 * Spec 014 (FR-016, plan §6): o operador do servidor cria um administrador local ou devolve o
 * acesso a um (administração global, senha temporária de troca obrigatória, desbloqueio e
 * ativação). Recupera instalações sem administrador acessível (ex.: só usuários do IdP).
 */
export async function recoverAdmin(
  db: Db,
  audit: AuditService,
  input: { email: string; name?: string },
): Promise<RecoveryResult> {
  const email = normalizeEmail(input.email);
  const temporaryPassword = randomBytes(18).toString('base64url');
  const passwordHash = await hashPassword(temporaryPassword);
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .forUpdate()
      .executeTakeFirst();
    const fields = {
      password_hash: passwordHash,
      must_change_password: true,
      is_admin: true,
      is_active: true,
      failed_logins: 0,
      locked_until: null,
    };
    const userId = existing
      ? (
          await trx
            .updateTable('users')
            .set({ ...fields, updated_at: sql<Date>`now()` })
            .where('id', '=', existing.id)
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id
      : (
          await trx
            .insertInto('users')
            .values({ ...fields, email, name: input.name?.trim() || null })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
    // A senha mudou: as sessões abertas deixam de valer.
    await trx
      .updateTable('user_sessions')
      .set({ revoked_at: sql<Date>`now()` })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
    await audit.record(
      trx,
      { userId: null, ip: null },
      {
        action: 'auth.admin_recovery',
        entityType: 'user',
        entityId: userId,
        details: { email, created: !existing, origin: 'cli' },
      },
    );
    return { userId, created: !existing, temporaryPassword };
  });
}
