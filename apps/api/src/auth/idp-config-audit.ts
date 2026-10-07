import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Db } from '@olly/db';
import { sql } from 'kysely';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';

/** Trava do registro (várias instâncias da API sobem juntas). */
const IDP_CONFIG_LOCK = 7_014_002;

/**
 * Spec 014 (FR-013): a ativação do IdP é configuração da instalação; o registro de auditoria
 * guarda a mudança quando a API sobe com um estado diferente do último registrado.
 */
export async function recordIdpConfig(
  db: Db,
  audit: AuditService,
  enabled: boolean,
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(${IDP_CONFIG_LOCK})`.execute(trx);
    const last = await trx
      .selectFrom('audit_log')
      .select('details')
      .where('action', '=', 'auth.idp_config')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    if ((last?.details as { enabled?: boolean } | null | undefined)?.enabled === enabled)
      return false;
    await audit.record(
      trx,
      { userId: null, ip: null },
      {
        action: 'auth.idp_config',
        entityType: 'system',
        entityId: 'idp',
        details: { enabled },
      },
    );
    return true;
  });
}

@Injectable()
export class IdpConfigAudit implements OnApplicationBootstrap {
  private readonly logger = new Logger('Autenticação');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const enabled = this.config.auth.idpEnabled;
    this.logger.log(
      enabled
        ? 'Login pelo IdP (OIDC) ativado, além do login local'
        : 'Login pelo IdP desativado: só login local',
    );
    // A subida não depende disso: se o banco não responder agora, só fica o aviso.
    try {
      if (await recordIdpConfig(this.db, this.audit, enabled)) {
        this.logger.log(
          `Mudança registrada na auditoria (IdP ${enabled ? 'ativado' : 'desativado'})`,
        );
      }
    } catch (error) {
      this.logger.warn(`Não foi possível registrar o estado do IdP na auditoria: ${String(error)}`);
    }
  }
}
