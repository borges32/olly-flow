import { Inject, Injectable } from '@nestjs/common';
import type { Db, User } from '@olly/db';
import { sql } from 'kysely';
import { AuditService } from '../audit/audit.service.js';
import { ConflictError, PermissionDeniedError, UnauthenticatedError } from '../common/errors.js';
import { DB } from '../core/tokens.js';
import type { AccessTokenClaims } from './auth.types.js';
import { IdpGroupSync } from './idp-group-sync.js';

const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 10_000;

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = error as { code?: unknown; constraint?: unknown };
  return e.code === '23505' && e.constraint === constraint;
}

/**
 * Espelha o usuário do IdP na tabela `users` (FR-005): cria no primeiro acesso e atualiza
 * nome e e-mail quando mudam. Um cache curto, chaveado pelas próprias claims, evita uma
 * escrita por requisição; qualquer mudança nas claims ignora o cache.
 *
 * Spec 009 (FR-005): na mesma passagem, sincroniza os vínculos herdados dos grupos do IdP. Como
 * os grupos fazem parte da chave do cache, um token novo com outros grupos (novo login)
 * sincroniza na hora.
 */
@Injectable()
export class UserSyncService {
  private readonly cache = new Map<string, { user: User; expiresAt: number }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(IdpGroupSync) private readonly groups: IdpGroupSync,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async sync(claims: AccessTokenClaims): Promise<User> {
    const email = claims.email?.trim().toLowerCase();
    if (!email) throw new UnauthenticatedError('Token sem a claim email');
    const name = claims.name ?? claims.preferred_username ?? null;

    const groups = [...(claims.groups ?? [])].sort();
    const key = JSON.stringify([claims.sub, email, name, groups]);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.user;

    const user = (await this.link(claims, email)) ?? (await this.upsert(claims.sub, email, name));
    if (user.is_active) await this.groups.sync(user.id, groups);
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(key, { user, expiresAt: Date.now() + CACHE_TTL_MS });
    return user;
  }

  /**
   * Spec 014 (FR-015): primeiro acesso pelo IdP com o e-mail de um usuário local (sem conta do
   * IdP) vincula as contas, desde que o IdP declare o e-mail verificado; senão, recusa. Devolve o
   * usuário vinculado, ou `undefined` quando não há o que vincular.
   */
  private async link(claims: AccessTokenClaims, email: string): Promise<User | undefined> {
    const known = await this.db
      .selectFrom('users')
      .select('id')
      .where('external_id', '=', claims.sub)
      .executeTakeFirst();
    if (known) return undefined;
    const local = await this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .where('external_id', 'is', null)
      .executeTakeFirst();
    if (!local) return undefined;
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    if (!verified) {
      await this.audit.record(
        this.db,
        { userId: null, ip: null },
        {
          action: 'auth.idp_link_refused',
          entityType: 'user',
          entityId: local.id,
          details: { email, sub: claims.sub, reason: 'e-mail não verificado pelo IdP' },
        },
      );
      throw new PermissionDeniedError(
        'Conta do IdP não vinculada: o IdP não confirmou o e-mail deste usuário',
      );
    }
    return this.db.transaction().execute(async (trx) => {
      const linked = await trx
        .updateTable('users')
        .set({ external_id: claims.sub, updated_at: sql<Date>`now()` })
        .where('id', '=', local.id)
        .where('external_id', 'is', null)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(
        trx,
        { userId: local.id, ip: null },
        {
          action: 'auth.idp_linked',
          entityType: 'user',
          entityId: local.id,
          details: { email, sub: claims.sub },
        },
      );
      return linked;
    });
  }

  /** Esquece o usuário em cache (ex.: desativado pela administração). */
  forget(userId: string): void {
    for (const [key, entry] of this.cache) if (entry.user.id === userId) this.cache.delete(key);
  }

  private async upsert(externalId: string, email: string, name: string | null): Promise<User> {
    try {
      const changed = await this.db
        .insertInto('users')
        .values({ external_id: externalId, email, name })
        .onConflict((oc) =>
          oc
            .column('external_id')
            .doUpdateSet({ email, name, updated_at: sql<Date>`now()` })
            .where((eb) =>
              eb.or([
                eb('users.email', 'is distinct from', email),
                eb('users.name', 'is distinct from', name),
              ]),
            ),
        )
        .returningAll()
        .executeTakeFirst();
      if (changed) return changed;
      // Nada mudou: o ON CONFLICT ... WHERE não devolve linha.
      return await this.db
        .selectFrom('users')
        .selectAll()
        .where('external_id', '=', externalId)
        .executeTakeFirstOrThrow();
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_key')) {
        throw new ConflictError('E-mail já associado a outro usuário da plataforma', {
          cause: error,
        });
      }
      throw error;
    }
  }
}
