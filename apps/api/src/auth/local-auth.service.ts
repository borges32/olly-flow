import { Inject, Injectable } from '@nestjs/common';
import type { Db, User } from '@olly/db';
import type { AuthConfig, LocalSessionResponse } from '@olly/shared-types';
import { sql } from 'kysely';
import { AuditService } from '../audit/audit.service.js';
import { ConflictError, UnauthenticatedError, UnprocessableError } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import type { AuthenticatedUser } from './auth.types.js';
import { LocalSessionService } from './local-session.service.js';
import { dummyHash, hashPassword, passwordProblems, verifyPassword } from './password.js';

/** Trava do primeiro cadastro (`pg_advisory_xact_lock`): uma chave fixa da plataforma. */
const SETUP_LOCK = 7_014_001;
/** Mensagem única de falha: não revela se o e-mail existe nem o motivo (FR-005). */
const INVALID = 'E-mail ou senha incorretos';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Recusa a senha fora da política (NFR-001), com os motivos para o formulário. */
export function assertPasswordPolicy(password: string, email: string): void {
  const problems = passwordProblems(password, email);
  if (problems.length > 0) {
    throw new UnprocessableError(problems[0] ?? 'Senha inválida', {
      issues: problems.map((message) => ({ code: 'password_policy', message, path: ['password'] })),
    });
  }
}

/**
 * Primeiro usuário e login local (spec 014, FR-001 a FR-005, FR-007, plan §2/§3). Tudo
 * auditado (FR-013); a senha nunca sai daqui (NFR-002).
 */
@Injectable()
export class LocalAuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LocalSessionService) private readonly sessions: LocalSessionService,
  ) {}

  private async hasUsers(db: Db = this.db): Promise<boolean> {
    return (await db.selectFrom('users').select('id').limit(1).executeTakeFirst()) !== undefined;
  }

  /** O que a tela de entrada oferece (FR-001, FR-010). */
  async authConfig(): Promise<AuthConfig> {
    return { setupRequired: !(await this.hasUsers()), idpEnabled: this.config.auth.idpEnabled };
  }

  private session(
    token: { token: string; expiresAt: Date },
    mustChangePassword: boolean,
  ): LocalSessionResponse {
    return { token: token.token, expiresAt: token.expiresAt.toISOString(), mustChangePassword };
  }

  /** FR-001 a FR-003: cadastro do primeiro usuário, aceito uma única vez (com trava). */
  async setup(
    input: { name: string; email: string; password: string },
    ip: string | null,
  ): Promise<LocalSessionResponse> {
    const email = normalizeEmail(input.email);
    assertPasswordPolicy(input.password, email);
    // Fora da trava: o hash leva ~0,1 s.
    const passwordHash = await hashPassword(input.password);
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(${SETUP_LOCK})`.execute(trx);
      if (await this.hasUsers(trx)) {
        throw new ConflictError('A instalação já foi configurada: entre com o seu usuário');
      }
      const user = await trx
        .insertInto('users')
        .values({
          email,
          name: input.name.trim(),
          password_hash: passwordHash,
          is_admin: true,
          last_login_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.record(
        trx,
        { userId: user.id, ip },
        {
          action: 'auth.setup',
          entityType: 'user',
          entityId: user.id,
          details: { email },
        },
      );
      return this.session(await this.sessions.create(user.id, trx), false);
    });
  }

  private async failure(
    ip: string | null,
    email: string,
    reason: string,
    user?: User,
  ): Promise<never> {
    await this.audit.record(
      this.db,
      { userId: null, ip },
      {
        action: 'auth.local_login_failed',
        entityType: 'user',
        entityId: user?.id ?? 'desconhecido',
        details: { email, reason },
      },
    );
    throw new UnauthenticatedError(INVALID);
  }

  /** FR-004/FR-005: login local com bloqueio por tentativas erradas. */
  async login(
    input: { email: string; password: string },
    ip: string | null,
  ): Promise<LocalSessionResponse> {
    const email = normalizeEmail(input.email);
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();
    // Sem usuário utilizável, ainda assim gasta o tempo de um hash (não revela o e-mail).
    if (!user?.password_hash || !user.is_active) {
      await verifyPassword(input.password, await dummyHash());
      return this.failure(
        ip,
        email,
        user ? (user.is_active ? 'sem_senha_local' : 'inativo') : 'inexistente',
        user,
      );
    }
    const ok = await verifyPassword(input.password, user.password_hash);
    if (user.locked_until && user.locked_until > new Date()) {
      return this.failure(ip, email, 'bloqueado', user);
    }
    if (!ok) {
      const attempts = user.failed_logins + 1;
      const lock = attempts >= this.config.auth.loginMaxAttempts;
      await this.db
        .updateTable('users')
        .set({
          failed_logins: lock ? 0 : attempts,
          ...(lock && { locked_until: new Date(Date.now() + this.config.auth.loginLockMs) }),
        })
        .where('id', '=', user.id)
        .execute();
      if (lock) {
        await this.audit.record(
          this.db,
          { userId: null, ip },
          {
            action: 'auth.local_locked',
            entityType: 'user',
            entityId: user.id,
            details: { email, minutes: Math.round(this.config.auth.loginLockMs / 60_000) },
          },
        );
      }
      return this.failure(ip, email, 'senha_incorreta', user);
    }
    return this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({ failed_logins: 0, locked_until: null, last_login_at: sql<Date>`now()` })
        .where('id', '=', user.id)
        .execute();
      await this.audit.record(
        trx,
        { userId: user.id, ip },
        {
          action: 'auth.local_login',
          entityType: 'user',
          entityId: user.id,
          details: { email },
        },
      );
      return this.session(await this.sessions.create(user.id, trx), user.must_change_password);
    });
  }

  async logout(user: AuthenticatedUser, ip: string | null): Promise<void> {
    if (!user.sessionId) return;
    await this.sessions.revoke(user.sessionId);
    await this.audit.record(
      this.db,
      { userId: user.id, ip },
      {
        action: 'auth.logout',
        entityType: 'user',
        entityId: user.id,
      },
    );
  }

  /** FR-007: troca da própria senha (exige a atual); encerra as outras sessões. */
  async changePassword(
    user: AuthenticatedUser,
    input: { currentPassword: string; newPassword: string },
    ip: string | null,
  ): Promise<void> {
    const row = await this.db
      .selectFrom('users')
      .select(['password_hash', 'email'])
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    if (!row.password_hash) throw new UnprocessableError('Este usuário não tem senha local');
    if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
      throw new UnprocessableError('A senha atual não confere', {
        issues: [
          {
            code: 'password_current',
            message: 'A senha atual não confere',
            path: ['currentPassword'],
          },
        ],
      });
    }
    assertPasswordPolicy(input.newPassword, row.email);
    const passwordHash = await hashPassword(input.newPassword);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({
          password_hash: passwordHash,
          must_change_password: false,
          updated_at: sql<Date>`now()`,
        })
        .where('id', '=', user.id)
        .execute();
      await this.sessions.revokeAll(user.id, user.sessionId, trx);
      await this.audit.record(
        trx,
        { userId: user.id, ip },
        {
          action: 'auth.password_change',
          entityType: 'user',
          entityId: user.id,
        },
      );
    });
    // A sessão atual não precisa mais trocar a senha.
    this.sessions.forget(user.id);
  }
}
