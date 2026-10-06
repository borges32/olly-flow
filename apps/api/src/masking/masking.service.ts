import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Db, MaskingRuleRow } from '@olly/db';
import { createMasker, type Masker } from '@olly/engine';
import type { MaskingRule } from '@olly/shared-types';
import { sql } from 'kysely';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../common/errors.js';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { createRedisConnection } from '../core/redis.js';
import { DB, REDIS } from '../core/tokens.js';
import { logMasking } from './log-masking.js';
import type { MaskingRuleBody } from './masking.schemas.js';

/** Garantia caso o aviso pelo Redis se perca: as regras são relidas neste intervalo. */
const CACHE_TTL_MS = 60_000;
/** Canal que avisa API e workers de mudanças nas regras. */
const RULES_CHANNEL = 'olly:masking-rules-changed';
const GLOBAL = '';

const toRule = (r: MaskingRuleRow): MaskingRule => ({
  id: r.id,
  scope: r.scope,
  projectId: r.project_id,
  kind: r.kind,
  matcher: r.matcher,
  action: r.action,
  enabled: r.enabled,
  builtin: r.builtin,
  description: r.description,
});

/**
 * Regras de mascaramento (spec 009, FR-014, FR-016; plan §6): globais e por projeto, com as
 * padrão semeadas pela migration. Entrega o `Masker` de cada projeto ao gravador de execuções e
 * mantém o dos logs (regras globais) atualizado.
 */
@Injectable()
export class MaskingService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Masking');
  private readonly cache = new Map<string, { masker: Promise<Masker>; expiresAt: number }>();
  private subscriber?: Redis;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = createRedisConnection(this.config.redisUrl, 'masking');
    this.subscriber.on('message', () => {
      this.clear();
    });
    void this.subscriber.subscribe(RULES_CHANNEL).catch((e: unknown) => {
      this.logger.warn(`Aviso de mudança de regras indisponível: ${String(e)}`);
    });
    // Sem banco na subida, os logs seguem com as regras padrão.
    await this.refreshLogMasker().catch((e: unknown) => {
      this.logger.warn(`Regras de mascaramento não carregadas: ${String(e)}`);
    });
  }

  onApplicationShutdown(): void {
    this.subscriber?.disconnect();
  }

  /** Regras globais + do projeto, ativas (FR-016). */
  forProject(projectId: string | null): Promise<Masker> {
    const key = projectId ?? GLOBAL;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.masker;
    const masker = this.load(projectId).catch((error: unknown) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, { masker, expiresAt: Date.now() + CACHE_TTL_MS });
    if (key === GLOBAL) {
      void masker.then(
        (m) => {
          logMasking.current = m;
        },
        () => undefined,
      );
    }
    return masker;
  }

  private async load(projectId: string | null): Promise<Masker> {
    const rows = await this.db
      .selectFrom('masking_rules')
      .select(['kind', 'matcher', 'action'])
      .where('enabled', '=', true)
      .where((eb) =>
        projectId
          ? eb.or([eb('scope', '=', 'global'), eb('project_id', '=', projectId)])
          : eb('scope', '=', 'global'),
      )
      .execute();
    return createMasker(rows, { salt: this.config.governance.maskingSalt });
  }

  private async refreshLogMasker(): Promise<void> {
    this.cache.delete(GLOBAL);
    logMasking.current = await this.forProject(null);
  }

  private clear(): void {
    this.cache.clear();
    void this.refreshLogMasker().catch(() => undefined);
  }

  /** Limpa o cache aqui e avisa as demais instâncias (FR-016: a regra vale na hora). */
  private async invalidate(): Promise<void> {
    this.clear();
    await this.redis.publish(RULES_CHANNEL, '1').catch((e: unknown) => {
      this.logger.warn(`Aviso de mudança de regras não publicado: ${String(e)}`);
    });
  }

  async list(projectId: string | null): Promise<MaskingRule[]> {
    const rows = await this.db
      .selectFrom('masking_rules')
      .selectAll()
      .where((eb) =>
        projectId
          ? eb.or([eb('scope', '=', 'global'), eb('project_id', '=', projectId)])
          : eb('scope', '=', 'global'),
      )
      .orderBy('scope')
      .orderBy('builtin', 'desc')
      .orderBy('created_at')
      .execute();
    return rows.map(toRule);
  }

  async create(
    ctx: AuditContext,
    projectId: string | null,
    body: MaskingRuleBody,
  ): Promise<MaskingRule> {
    const rule = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('masking_rules')
        .values({
          scope: projectId ? 'project' : 'global',
          project_id: projectId,
          kind: body.kind,
          matcher: body.matcher,
          action: body.action,
          enabled: body.enabled ?? true,
          description: body.description ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, ctx, {
        action: 'masking_rule.create',
        entityType: 'masking_rule',
        entityId: row.id,
        details: {
          scope: row.scope,
          projectId,
          kind: row.kind,
          matcher: row.matcher,
          action: row.action,
        },
      });
      return toRule(row);
    });
    await this.invalidate();
    return rule;
  }

  async update(
    ctx: AuditContext,
    projectId: string | null,
    id: string,
    body: MaskingRuleBody,
  ): Promise<MaskingRule> {
    const rule = await this.db.transaction().execute(async (trx) => {
      const current = await this.find(trx, projectId, id);
      if (current.builtin && (current.kind !== body.kind || current.matcher !== body.matcher)) {
        throw new UnprocessableError(
          'Regras padrão só podem ser ativadas, desativadas ou mudar de ação',
        );
      }
      const row = await trx
        .updateTable('masking_rules')
        .set({
          kind: body.kind,
          matcher: body.matcher,
          action: body.action,
          enabled: body.enabled ?? current.enabled,
          description: body.description === undefined ? current.description : body.description,
          updated_at: sql<Date>`now()`,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, ctx, {
        action: 'masking_rule.update',
        entityType: 'masking_rule',
        entityId: id,
        details: {
          from: { matcher: current.matcher, action: current.action, enabled: current.enabled },
          to: { matcher: row.matcher, action: row.action, enabled: row.enabled },
        },
      });
      return toRule(row);
    });
    await this.invalidate();
    return rule;
  }

  async remove(ctx: AuditContext, projectId: string | null, id: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const current = await this.find(trx, projectId, id);
      if (current.builtin) {
        throw new ConflictError('Regras padrão não podem ser excluídas; desative-as');
      }
      await trx.deleteFrom('masking_rules').where('id', '=', id).execute();
      await this.audit.record(trx, ctx, {
        action: 'masking_rule.delete',
        entityType: 'masking_rule',
        entityId: id,
        details: { scope: current.scope, matcher: current.matcher },
      });
    });
    await this.invalidate();
  }

  /** A regra precisa ser do escopo da rota (global ou deste projeto). */
  private async find(
    db: Pick<Db, 'selectFrom'>,
    projectId: string | null,
    id: string,
  ): Promise<MaskingRuleRow> {
    const row = await db
      .selectFrom('masking_rules')
      .selectAll()
      .where('id', '=', id)
      .where((eb) => (projectId ? eb('project_id', '=', projectId) : eb('scope', '=', 'global')))
      .executeTakeFirst();
    if (!row) throw new NotFoundError('Regra de mascaramento não encontrada');
    return row;
  }
}
