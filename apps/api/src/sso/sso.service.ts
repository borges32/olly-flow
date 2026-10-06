import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@olly/db';
import type {
  GroupRoleMapping,
  GroupRoleMappingInput,
  LoginResponse,
  RoleName,
  UserAdminSummary,
} from '@olly/shared-types';
import { decodeJwt } from 'jose';
import { sql } from 'kysely';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { Authenticator } from '../auth/authenticator.js';
import { IdpGroupSync } from '../auth/idp-group-sync.js';
import { UserSyncService } from '../auth/user-sync.service.js';
import { ConflictError, NotFoundError, TooManyRequestsError } from '../common/errors.js';
import { DB } from '../core/tokens.js';
import { FixedWindowLimiter } from '../webhooks/rate-limiter.js';

const iso = (d: Date) => d.toISOString();
const UNIQUE_VIOLATION = '23505';
/** Falhas de login auditadas por IP e minuto (o endpoint é público). */
const FAILED_LOGINS_PER_MIN = 30;

/**
 * SSO e usuários (spec 009, FR-004 a FR-007; plan §2). O login acontece no IdP (OIDC); a
 * plataforma registra o login quando o frontend apresenta o token novo (`POST /auth/login`).
 */
@Injectable()
export class SsoService {
  private readonly failures = new FixedWindowLimiter();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Authenticator) private readonly authenticator: Authenticator,
    @Inject(IdpGroupSync) private readonly groups: IdpGroupSync,
    @Inject(UserSyncService) private readonly users: UserSyncService,
  ) {}

  /**
   * FR-005/FR-007: valida o token, sincroniza os vínculos por grupo e audita o login. Falhas
   * (token inválido, usuário inativo) são auditadas como `auth.login_failed`, sem o token.
   */
  async login(token: string | undefined, ip: string | null): Promise<LoginResponse> {
    let auth;
    try {
      auth = await this.authenticator.authenticate(token);
    } catch (error) {
      await this.recordFailure(token, ip, error);
      throw error;
    }
    const memberships = await this.groups.sync(auth.account.id, auth.claims.groups ?? []);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({ last_login_at: sql<Date>`now()` })
        .where('id', '=', auth.account.id)
        .execute();
      await this.audit.record(
        trx,
        { userId: auth.account.id, ip },
        {
          action: 'auth.login',
          entityType: 'user',
          entityId: auth.account.id,
          details: { email: auth.account.email, groups: auth.claims.groups ?? [] },
        },
      );
    });
    return { userId: auth.account.id, idpMemberships: memberships };
  }

  private async recordFailure(
    token: string | undefined,
    ip: string | null,
    error: unknown,
  ): Promise<void> {
    if (!this.failures.hit(`login:${ip ?? '-'}`, FAILED_LOGINS_PER_MIN)) {
      throw new TooManyRequestsError('Muitas tentativas de login; aguarde um minuto');
    }
    // O `sub` não verificado só ajuda a investigar; nunca é usado para autorizar.
    let unverifiedSub: string | null;
    let userId: string | null = null;
    try {
      unverifiedSub = token ? (decodeJwt(token).sub ?? null) : null;
    } catch {
      unverifiedSub = null;
    }
    if (unverifiedSub) {
      const user = await this.db
        .selectFrom('users')
        .select('id')
        .where('external_id', '=', unverifiedSub)
        .executeTakeFirst();
      userId = user?.id ?? null;
    }
    await this.audit.record(
      this.db,
      { userId: null, ip },
      {
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: userId ?? unverifiedSub ?? 'desconhecido',
        details: {
          reason: error instanceof Error ? error.message : String(error),
          ...(unverifiedSub && { unverifiedSub }),
        },
      },
    );
  }

  async listUsers(): Promise<UserAdminSummary[]> {
    const rows = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'is_active', 'last_login_at', 'created_at'])
      .orderBy('email')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      isActive: r.is_active,
      lastLoginAt: r.last_login_at ? iso(r.last_login_at) : null,
      createdAt: iso(r.created_at),
    }));
  }

  /** FR-006: reativa (ex.: após inativação por falta de uso) ou desativa um usuário. */
  async setActive(ctx: AuditContext, userId: string, active: boolean): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
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
      await this.audit.record(trx, ctx, {
        action: active ? 'user.activate' : 'user.deactivate',
        entityType: 'user',
        entityId: userId,
        details: { email: updated.email },
      });
    });
    this.users.forget(userId);
  }

  async listMappings(): Promise<GroupRoleMapping[]> {
    const rows = await this.db
      .selectFrom('group_role_mappings as m')
      .innerJoin('roles as r', 'r.id', 'm.role_id')
      .leftJoin('projects as p', 'p.id', 'm.project_id')
      .select([
        'm.id',
        'm.idp_group',
        'm.project_id',
        'p.name as project_name',
        'r.name as role',
        'm.created_at',
      ])
      .orderBy('m.idp_group')
      .orderBy('p.name')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      idpGroup: r.idp_group,
      projectId: r.project_id,
      projectName: r.project_name,
      role: r.role as RoleName,
      createdAt: iso(r.created_at),
    }));
  }

  async createMapping(ctx: AuditContext, input: GroupRoleMappingInput): Promise<GroupRoleMapping> {
    const id = await this.db
      .transaction()
      .execute(async (trx) => {
        if (input.projectId) {
          const project = await trx
            .selectFrom('projects')
            .select('id')
            .where('id', '=', input.projectId)
            .executeTakeFirst();
          if (!project) throw new NotFoundError('Projeto não encontrado');
        }
        const role = await trx
          .selectFrom('roles')
          .select('id')
          .where('name', '=', input.role)
          .executeTakeFirstOrThrow();
        const row = await trx
          .insertInto('group_role_mappings')
          .values({
            idp_group: input.idpGroup,
            project_id: input.projectId,
            role_id: role.id,
            created_by: ctx.userId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, ctx, {
          action: 'sso.mapping.create',
          entityType: 'group_role_mapping',
          entityId: row.id,
          details: { ...input },
        });
        return row.id;
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
          throw new ConflictError('Este grupo já tem um papel neste escopo');
        }
        throw error;
      });
    const created = (await this.listMappings()).find((m) => m.id === id);
    if (!created) throw new NotFoundError('Mapeamento não encontrado');
    return created;
  }

  /** Os vínculos já herdados saem no próximo login de cada usuário (sincronização). */
  async deleteMapping(ctx: AuditContext, id: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .deleteFrom('group_role_mappings')
        .where('id', '=', id)
        .returning(['idp_group', 'project_id'])
        .executeTakeFirst();
      if (!row) throw new NotFoundError('Mapeamento não encontrado');
      await this.audit.record(trx, ctx, {
        action: 'sso.mapping.delete',
        entityType: 'group_role_mapping',
        entityId: id,
        details: { idpGroup: row.idp_group, projectId: row.project_id },
      });
    });
  }
}
