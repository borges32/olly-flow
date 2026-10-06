import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { mcpAuth } from '@olly/mcp-client';
import type { McpOAuthAuthorizeResponse, McpOAuthStatus } from '@olly/shared-types';
import type { Redis } from 'ioredis';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { UnprocessableError } from '../common/errors.js';
import { REDIS, DB } from '../core/tokens.js';
import type { Db } from '@olly/db';
import { CredentialsService } from '../credentials/credentials.service.js';
import { McpConnections } from './mcp-connections.service.js';

/** Autorização pendente: `state` → credencial e verificador PKCE, por 10 minutos. */
const PENDING_TTL_S = 600;
const pendingKey = (state: string) => `olly:mcp-oauth:${state}`;

interface Pending {
  credentialId: string;
  codeVerifier: string;
  userId: string | null;
  ip: string | null;
}

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

/**
 * OAuth 2.1 dos servidores MCP (spec 010, FR-007, plan §4): "Conectar" na credencial
 * `mcpOAuth` gera a URL de autorização (descoberta + PKCE + registro dinâmico pelo SDK) e o
 * callback troca o código pelos tokens, gravados cifrados na credencial.
 */
@Injectable()
export class McpOAuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
    @Inject(McpConnections) private readonly connections: McpConnections,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async oauthCredential(id: string) {
    const { credential } = await this.credentials.resolveById(id);
    if (credential.type !== 'mcpOAuth') {
      throw new UnprocessableError('A credencial não é do tipo MCP: OAuth 2.1');
    }
    const serverUrl = str(credential.data.serverUrl);
    if (!serverUrl) throw new UnprocessableError('Informe a URL do servidor MCP na credencial');
    return { credential, serverUrl };
  }

  async authorize(ctx: AuditContext, credentialId: string): Promise<McpOAuthAuthorizeResponse> {
    const { credential, serverUrl } = await this.oauthCredential(credentialId);
    const state = randomUUID();
    const provider = this.connections.oauthProvider(credential, {
      interactive: true,
      state,
      ignoreTokens: true,
    });
    let result: string;
    try {
      result = await mcpAuth(provider, {
        serverUrl,
        ...(str(credential.data.scope) && { scope: str(credential.data.scope) }),
        fetchFn: this.connections.fetch,
      });
    } catch (error) {
      throw new UnprocessableError(
        `Não foi possível iniciar a autorização OAuth: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (result !== 'REDIRECT' || !provider.authorizationUrl || !provider.pendingCodeVerifier) {
      throw new UnprocessableError('O servidor de autorização não pediu a autorização do usuário');
    }
    const pending: Pending = {
      credentialId,
      codeVerifier: provider.pendingCodeVerifier,
      userId: ctx.userId,
      ip: ctx.ip,
    };
    await this.redis.set(pendingKey(state), JSON.stringify(pending), 'EX', PENDING_TTL_S);
    return { authorizationUrl: provider.authorizationUrl.toString() };
  }

  /** Callback do servidor de autorização: `state` de uso único (CSRF), troca código por tokens. */
  async callback(query: { code?: string; state: string; error?: string }): Promise<void> {
    const raw = await this.redis.getdel(pendingKey(query.state));
    if (!raw) throw new UnprocessableError('Autorização desconhecida ou expirada; conecte de novo');
    const pending = JSON.parse(raw) as Pending;
    if (query.error || !query.code) {
      throw new UnprocessableError(`Autorização recusada: ${query.error ?? 'sem código'}`);
    }
    const { credential, serverUrl } = await this.oauthCredential(pending.credentialId);
    const provider = this.connections.oauthProvider(credential, {
      codeVerifier: pending.codeVerifier,
      ignoreTokens: true,
    });
    try {
      await mcpAuth(provider, {
        serverUrl,
        authorizationCode: query.code,
        ...(str(credential.data.scope) && { scope: str(credential.data.scope) }),
        fetchFn: this.connections.fetch,
      });
    } catch (error) {
      throw new UnprocessableError(
        `Não foi possível obter o token: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const row = await this.db
      .selectFrom('credentials')
      .select(['project_id', 'name'])
      .where('id', '=', pending.credentialId)
      .executeTakeFirstOrThrow();
    await this.audit.record(
      this.db,
      { userId: pending.userId, ip: pending.ip },
      {
        action: 'credential.oauth_connect',
        entityType: 'credential',
        entityId: pending.credentialId,
        details: { projectId: row.project_id, name: row.name, type: 'mcpOAuth' },
      },
    );
  }

  async status(credentialId: string): Promise<McpOAuthStatus> {
    const { credential } = await this.oauthCredential(credentialId);
    const data = credential.data;
    return {
      connected: Boolean(str(data.accessToken)),
      expiresAt: str(data.expiresAt) ?? null,
      scope: str(data.scope) ?? null,
    };
  }
}
