import { Inject, Injectable } from '@nestjs/common';
import { decryptCredentialData, encryptCredentialData, type Db, type KeyRing } from '@olly/db';
import type { OllyChatConfig, OllyChatConfigUpdate } from '@olly/shared-types';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { UnprocessableError } from '../common/errors.js';
import { DB } from '../core/tokens.js';
import { KEY_PROVIDER } from '../credentials/credentials.service.js';

/** Dado adicional da criptografia do segredo do Olly Chat (como o id, nas credenciais). */
export const OLLY_CHAT_AAD = 'olly_chat_config';

interface AuthSecrets {
  headerName?: string;
  headerValue?: string;
  basicUser?: string;
  basicPassword?: string;
}

/** Configuração em uso no envio: URL e o cabeçalho de autenticação já montado. */
export interface OllyChatTarget {
  webhookUrl: string;
  retentionDays: number;
  headers: Record<string, string>;
}

/**
 * Configuração do Olly Chat (spec 028, FR-008, plan §3): URL do webhook, retenção e
 * autenticação opcional. Os segredos ficam criptografados como as credenciais e nunca voltam.
 */
@Injectable()
export class OllyChatConfigService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(KEY_PROVIDER) private readonly keys: KeyRing,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private row() {
    return this.db.selectFrom('olly_chat_config').selectAll().executeTakeFirst();
  }

  private async secrets(blob: Buffer | null): Promise<AuthSecrets> {
    return blob ? await decryptCredentialData(blob, this.keys, OLLY_CHAT_AAD) : {};
  }

  /** Para a tela de administração: sem segredos. */
  async get(): Promise<OllyChatConfig> {
    const row = await this.row();
    if (!row) {
      return {
        webhookUrl: null,
        retentionDays: 7,
        authType: 'none',
        headerName: null,
        basicUser: null,
        hasSecret: false,
        updatedAt: null,
        updatedBy: null,
      };
    }
    const secrets = await this.secrets(row.auth_encrypted);
    const authType = row.auth_type;
    return {
      webhookUrl: row.webhook_url,
      retentionDays: row.retention_days,
      authType,
      headerName: authType === 'headerAuth' ? (secrets.headerName ?? null) : null,
      basicUser: authType === 'basicAuth' ? (secrets.basicUser ?? null) : null,
      hasSecret:
        (authType === 'headerAuth' && Boolean(secrets.headerValue)) ||
        (authType === 'basicAuth' && Boolean(secrets.basicPassword)),
      updatedAt: row.updated_at.toISOString(),
      updatedBy: row.updated_by,
    };
  }

  /** Segredo vazio ou ausente mantém o guardado; trocar o tipo de autenticação recomeça. */
  async update(ctx: AuditContext, input: OllyChatConfigUpdate): Promise<OllyChatConfig> {
    const before = await this.row();
    const previous =
      before?.auth_type === input.authType ? await this.secrets(before.auth_encrypted) : {};
    const keep = (value: string | undefined, old: string | undefined) => (value ? value : old);
    let secrets: AuthSecrets = {};
    if (input.authType === 'headerAuth') {
      secrets = {
        headerName: input.headerName?.trim() || previous.headerName,
        headerValue: keep(input.headerValue, previous.headerValue),
      };
      if (!secrets.headerName || !secrets.headerValue) {
        throw new UnprocessableError('Informe o nome e o valor do cabeçalho de autenticação');
      }
    } else if (input.authType === 'basicAuth') {
      secrets = {
        basicUser: input.basicUser?.trim() || previous.basicUser,
        basicPassword: keep(input.basicPassword, previous.basicPassword),
      };
      if (!secrets.basicUser || !secrets.basicPassword) {
        throw new UnprocessableError('Informe o usuário e a senha da autenticação Basic');
      }
    }
    const sealed =
      input.authType === 'none'
        ? null
        : await encryptCredentialData({ ...secrets }, this.keys, OLLY_CHAT_AAD);
    const values = {
      webhook_url: input.webhookUrl,
      retention_days: input.retentionDays,
      auth_type: input.authType,
      auth_encrypted: sealed?.blob ?? null,
      key_version: sealed?.keyVersion ?? null,
      key_provider: sealed?.keyProvider ?? null,
      updated_by: ctx.userId,
      updated_at: new Date(),
    };
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('olly_chat_config')
        .values({ id: true, ...values })
        .onConflict((oc) => oc.column('id').doUpdateSet(values))
        .execute();
      // Sem segredos nos detalhes (constituição, Art. III).
      await this.audit.record(trx, ctx, {
        action: 'olly_chat.config',
        entityType: 'system',
        entityId: 'olly_chat',
        details: {
          from: before
            ? {
                webhookUrl: before.webhook_url,
                retentionDays: before.retention_days,
                authType: before.auth_type,
              }
            : null,
          to: {
            webhookUrl: input.webhookUrl,
            retentionDays: input.retentionDays,
            authType: input.authType,
          },
        },
      });
    });
    return this.get();
  }

  /** Para o envio: `null` sem URL configurada. */
  async target(): Promise<OllyChatTarget | null> {
    const row = await this.row();
    if (!row?.webhook_url) return null;
    const secrets = await this.secrets(row.auth_encrypted);
    const headers: Record<string, string> = {};
    if (row.auth_type === 'headerAuth' && secrets.headerName && secrets.headerValue) {
      headers[secrets.headerName] = secrets.headerValue;
    }
    if (row.auth_type === 'basicAuth' && secrets.basicUser && secrets.basicPassword) {
      headers.authorization = `Basic ${Buffer.from(`${secrets.basicUser}:${secrets.basicPassword}`).toString('base64')}`;
    }
    return { webhookUrl: row.webhook_url, retentionDays: row.retention_days, headers };
  }

  /** Retenção em dias (padrão 7 sem configuração), para a manutenção. */
  async retentionDays(): Promise<number> {
    return (await this.row())?.retention_days ?? 7;
  }
}
