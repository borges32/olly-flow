import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Db, User } from '@olly/db';
import { sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';

/** Prefixo dos tokens de sessão local: o `Authenticator` distingue do token OIDC por ele. */
export const LOCAL_TOKEN_PREFIX = 'olly_s_';

/** Validade do cache: um usuário desativado perde o acesso em até 30 s (SC-004: até 1 min). */
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 10_000;
/** `last_used_at` é gravado no máximo uma vez por minuto (inatividade). */
const TOUCH_INTERVAL_MS = 60_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface LocalSession {
  sessionId: string;
  user: User;
}

/**
 * Sessões locais (spec 014, FR-004, FR-008, NFR-004, plan §2): token opaco entregue uma vez,
 * guardado só como hash; expira por inatividade e por tempo máximo; revogado ao sair, ao trocar
 * a senha e ao desativar o usuário.
 */
@Injectable()
export class LocalSessionService {
  private readonly cache = new Map<string, { session: LocalSession; expiresAt: number }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Abre uma sessão para o usuário (dentro da transação, se houver). */
  async create(userId: string, db: Db = this.db): Promise<{ token: string; expiresAt: Date }> {
    const token = `${LOCAL_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + this.config.auth.sessionMaxMs);
    await db
      .insertInto('user_sessions')
      .values({ user_id: userId, token_hash: hashToken(token), expires_at: expiresAt })
      .execute();
    return { token, expiresAt };
  }

  /** Sessão válida do token, ou `null` (inexistente, revogada, expirada ou usuário inativo). */
  async validate(token: string): Promise<LocalSession | null> {
    const key = hashToken(token);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.session;
    const idleCutoff = new Date(Date.now() - this.config.auth.sessionIdleMs);
    const row = await this.db
      .selectFrom('user_sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .selectAll('u')
      .select(['s.id as session_id', 's.last_used_at as session_last_used_at'])
      .where('s.token_hash', '=', key)
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', new Date())
      .where('s.last_used_at', '>', idleCutoff)
      .where('u.is_active', '=', true)
      .executeTakeFirst();
    if (!row) {
      this.cache.delete(key);
      return null;
    }
    const { session_id: sessionId, session_last_used_at: lastUsed, ...user } = row;
    if (Date.now() - lastUsed.getTime() > TOUCH_INTERVAL_MS) {
      await this.db
        .updateTable('user_sessions')
        .set({ last_used_at: sql<Date>`now()` })
        .where('id', '=', sessionId)
        .execute();
    }
    const session = { sessionId, user };
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(key, { session, expiresAt: Date.now() + CACHE_TTL_MS });
    return session;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db
      .updateTable('user_sessions')
      .set({ revoked_at: sql<Date>`now()` })
      .where('id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .execute();
    for (const [key, entry] of this.cache) {
      if (entry.session.sessionId === sessionId) this.cache.delete(key);
    }
  }

  /** Revoga as sessões do usuário (exceto, se informada, a atual). */
  async revokeAll(userId: string, exceptSessionId?: string, db: Db = this.db): Promise<void> {
    await db
      .updateTable('user_sessions')
      .set({ revoked_at: sql<Date>`now()` })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .$if(exceptSessionId !== undefined, (q) => q.where('id', '!=', exceptSessionId ?? ''))
      .execute();
    this.forget(userId, exceptSessionId);
  }

  /** Esquece o usuário no cache local (ex.: desativado ou com dados alterados). */
  forget(userId: string, exceptSessionId?: string): void {
    for (const [key, entry] of this.cache) {
      if (entry.session.user.id === userId && entry.session.sessionId !== exceptSessionId) {
        this.cache.delete(key);
      }
    }
  }

  /** Limpeza (job de manutenção): sessões expiradas ou revogadas há mais de `days` dias. */
  async purge(days = 7, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const result = await this.db
      .deleteFrom('user_sessions')
      .where((eb) => eb.or([eb('expires_at', '<', cutoff), eb('revoked_at', '<', cutoff)]))
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}
