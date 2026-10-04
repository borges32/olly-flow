import { Injectable } from '@nestjs/common';
import type { Db } from '@olly/db';
import type { Transaction } from 'kysely';
import type { Database } from '@olly/db';
import type { RequestWithUser } from '../auth/current-user.decorator.js';

export interface AuditContext {
  userId: string | null;
  ip: string | null;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
}

export function auditContext(request: RequestWithUser): AuditContext {
  return { userId: request.user?.id ?? null, ip: request.ip || null };
}

/**
 * Registro de auditoria (spec 002, FR-014). Recebe a transação da operação auditada para
 * que o registro e a mudança sejam gravados juntos. Não registre segredos em `details`.
 */
@Injectable()
export class AuditService {
  async record(
    db: Db | Transaction<Database>,
    ctx: AuditContext,
    entry: AuditEntry,
  ): Promise<void> {
    await db
      .insertInto('audit_log')
      .values({
        user_id: ctx.userId,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        details: entry.details ? JSON.stringify(entry.details) : null,
        ip: ctx.ip,
      })
      .execute();
  }
}
