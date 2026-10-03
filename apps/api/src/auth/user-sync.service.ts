import { Inject, Injectable } from '@nestjs/common';
import type { Db, User } from '@olly/db';
import { sql } from 'kysely';
import { ConflictError, UnauthenticatedError } from '../common/errors.js';
import { DB } from '../core/tokens.js';
import type { AccessTokenClaims } from './auth.types.js';

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
 */
@Injectable()
export class UserSyncService {
  private readonly cache = new Map<string, { user: User; expiresAt: number }>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async sync(claims: AccessTokenClaims): Promise<User> {
    const email = claims.email?.trim().toLowerCase();
    if (!email) throw new UnauthenticatedError('Token sem a claim email');
    const name = claims.name ?? claims.preferred_username ?? null;

    const key = JSON.stringify([claims.sub, email, name]);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.user;

    const user = await this.upsert(claims.sub, email, name);
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(key, { user, expiresAt: Date.now() + CACHE_TTL_MS });
    return user;
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
