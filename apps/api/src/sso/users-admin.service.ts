import { Inject, Injectable } from '@nestjs/common';
import type { Database, Db } from '@olly/db';
import type {
  CreateLocalUserRequest,
  UpdateUserRequest,
  UserAdminSummary,
} from '@olly/shared-types';
import { sql, type Transaction } from 'kysely';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { assertPasswordPolicy, normalizeEmail } from '../auth/local-auth.service.js';
import { LocalSessionService } from '../auth/local-session.service.js';
import { hashPassword } from '../auth/password.js';
import { UserSyncService } from '../auth/user-sync.service.js';
import { ConflictError, NotFoundError } from '../common/errors.js';
import { DB } from '../core/tokens.js';
import { SsoService } from './sso.service.js';

const UNIQUE_VIOLATION = '23505';
const LAST_ADMIN = 'A plataforma precisa de ao menos um administrador ativo';

const isEmailTaken = (error: unknown) => (error as { code?: unknown }).code === UNIQUE_VIOLATION;

/**
 * Administração de usuários (spec 014, FR-006 a FR-009, FR-014, plan §4): usuários locais,
 * redefinição de senha, administração global e ativação. Nunca deixa a plataforma sem
 * administrador ativo; desativar ou redefinir a senha encerra as sessões.
 */
@Injectable()
export class UsersAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LocalSessionService) private readonly sessions: LocalSessionService,
    @Inject(UserSyncService) private readonly idpUsers: UserSyncService,
    @Inject(SsoService) private readonly sso: SsoService,
  ) {}

  private async summary(userId: string): Promise<UserAdminSummary> {
    const user = (await this.sso.listUsers()).find((u) => u.id === userId);
    if (!user) throw new NotFoundError('Usuário não encontrado');
    return user;
  }

  /** FR-009: recusa tirar do usuário a última administração ativa (trava as linhas). */
  private async assertNotLastAdmin(trx: Transaction<Database>, userId: string): Promise<void> {
    const admins = await trx
      .selectFrom('users')
      .select('id')
      .where('is_admin', '=', true)
      .where('is_active', '=', true)
      .forUpdate()
      .execute();
    if (admins.length === 1 && admins[0]?.id === userId) throw new ConflictError(LAST_ADMIN);
  }

  /** FR-006/FR-007: usuário local com senha inicial de troca obrigatória. */
  async create(ctx: AuditContext, input: CreateLocalUserRequest): Promise<UserAdminSummary> {
    const email = normalizeEmail(input.email);
    assertPasswordPolicy(input.password, email);
    const passwordHash = await hashPassword(input.password);
    const id = await this.db
      .transaction()
      .execute(async (trx) => {
        const user = await trx
          .insertInto('users')
          .values({
            email,
            name: input.name.trim(),
            password_hash: passwordHash,
            must_change_password: true,
            is_admin: input.isAdmin ?? false,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, ctx, {
          action: 'user.create',
          entityType: 'user',
          entityId: user.id,
          details: { email, isAdmin: input.isAdmin ?? false },
        });
        return user.id;
      })
      .catch((error: unknown) => {
        if (isEmailTaken(error)) throw new ConflictError('Já existe um usuário com este e-mail');
        throw error;
      });
    return this.summary(id);
  }

  /** FR-006: nome, e-mail e administração global (FR-009 protege o último administrador). */
  async update(
    ctx: AuditContext,
    userId: string,
    input: UpdateUserRequest,
  ): Promise<UserAdminSummary> {
    await this.db
      .transaction()
      .execute(async (trx) => {
        const current = await trx
          .selectFrom('users')
          .select(['email', 'name', 'is_admin'])
          .where('id', '=', userId)
          .forUpdate()
          .executeTakeFirst();
        if (!current) throw new NotFoundError('Usuário não encontrado');
        if (input.isAdmin === false && current.is_admin) await this.assertNotLastAdmin(trx, userId);
        const email = input.email === undefined ? undefined : normalizeEmail(input.email);
        await trx
          .updateTable('users')
          .set({
            ...(input.name !== undefined && { name: input.name.trim() }),
            ...(email !== undefined && { email }),
            ...(input.isAdmin !== undefined && { is_admin: input.isAdmin }),
            updated_at: sql<Date>`now()`,
          })
          .where('id', '=', userId)
          .execute();
        const changes = {
          ...(input.name !== undefined &&
            input.name.trim() !== current.name && { name: input.name.trim() }),
          ...(email !== undefined && email !== current.email && { email }),
        };
        if (Object.keys(changes).length > 0) {
          await this.audit.record(trx, ctx, {
            action: 'user.update',
            entityType: 'user',
            entityId: userId,
            details: changes,
          });
        }
        if (input.isAdmin !== undefined && input.isAdmin !== current.is_admin) {
          await this.audit.record(trx, ctx, {
            action: input.isAdmin ? 'user.admin_grant' : 'user.admin_revoke',
            entityType: 'user',
            entityId: userId,
            details: { email: email ?? current.email },
          });
        }
      })
      .catch((error: unknown) => {
        if (isEmailTaken(error)) throw new ConflictError('Já existe um usuário com este e-mail');
        throw error;
      });
    this.forget(userId);
    return this.summary(userId);
  }

  /** FR-006/FR-007: nova senha de troca obrigatória; desbloqueia e encerra as sessões. */
  async resetPassword(ctx: AuditContext, userId: string, password: string): Promise<void> {
    const user = await this.db
      .selectFrom('users')
      .select('email')
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user) throw new NotFoundError('Usuário não encontrado');
    assertPasswordPolicy(password, user.email);
    const passwordHash = await hashPassword(password);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({
          password_hash: passwordHash,
          must_change_password: true,
          failed_logins: 0,
          locked_until: null,
          updated_at: sql<Date>`now()`,
        })
        .where('id', '=', userId)
        .execute();
      await this.sessions.revokeAll(userId, undefined, trx);
      await this.audit.record(trx, ctx, {
        action: 'auth.password_reset',
        entityType: 'user',
        entityId: userId,
        details: { email: user.email },
      });
    });
    this.forget(userId);
  }

  /** Spec 009 (FR-006) e spec 014 (FR-008, FR-009): ativa ou desativa, encerrando as sessões. */
  async setActive(ctx: AuditContext, userId: string, active: boolean): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      if (!active) await this.assertNotLastAdmin(trx, userId);
      const updated = await trx
        .updateTable('users')
        .set({
          is_active: active,
          // Reativado: conta a partir de agora para a inativação por falta de uso.
          ...(active && { last_login_at: sql<Date>`now()` }),
        })
        .where('id', '=', userId)
        .returning('email')
        .executeTakeFirst();
      if (!updated) throw new NotFoundError('Usuário não encontrado');
      if (!active) await this.sessions.revokeAll(userId, undefined, trx);
      await this.audit.record(trx, ctx, {
        action: active ? 'user.activate' : 'user.deactivate',
        entityType: 'user',
        entityId: userId,
        details: { email: updated.email },
      });
    });
    this.forget(userId);
  }

  private forget(userId: string): void {
    this.sessions.forget(userId);
    this.idpUsers.forget(userId);
  }
}
