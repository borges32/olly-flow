import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Db, McpServerRow } from '@olly/db';
import {
  McpConnection,
  McpConnectionPool,
  guardedFetchLike,
  snapshotDiff,
  type GuardedFetch,
  type McpClientSettings,
  type McpConnectionConfig,
} from '@olly/mcp-client';
import { mcpHeaderLines, type HttpGuard, type ResolvedCredential } from '@olly/nodes';
import type { McpSnapshotDiff, McpToolDefinition, McpToolsSnapshot } from '@olly/shared-types';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB } from '../core/tokens.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { HTTP_GUARD } from '../node-types/node-types.module.js';
import { CredentialOAuthProvider } from './mcp-oauth-provider.js';

/** Erro de configuração do servidor ou da credencial (mensagem para o usuário). */
export class McpConfigurationError extends Error {
  override name = 'McpConfigurationError';
}

/**
 * Conexões com os servidores MCP do catálogo (spec 010, plan §3–§4): reaproveitadas por
 * servidor e credencial (FR-006), sempre pelo `fetch` com anti-SSRF (FR-004, SC-005). A cada
 * conexão nova (e a cada `tools/list_changed`), as tools anunciadas são comparadas com o
 * snapshot aprovado e a divergência é gravada para revisão (FR-003).
 */
@Injectable()
export class McpConnections implements OnApplicationShutdown {
  private readonly logger = new Logger('McpConnections');
  private readonly settings: McpClientSettings;
  private readonly pool: McpConnectionPool;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HTTP_GUARD) guard: HttpGuard,
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
  ) {
    // O `fetch` do undici e o global têm tipos diferentes, mas o mesmo formato.
    const guarded = ((url: string | URL, init: Parameters<GuardedFetch>[1]) =>
      guard.fetch(url, init)) as unknown as GuardedFetch;
    this.settings = {
      fetch: guardedFetchLike(guarded, config.mcp.maxResultBytes),
      callTimeoutMs: config.mcp.callTimeoutMs,
      maxResultBytes: config.mcp.maxResultBytes,
      clientInfo: { name: 'olly-flow', version: '1.0.0' },
      onToolsListed: (serverId, tools) => this.compareSnapshot(serverId, tools),
    };
    this.pool = new McpConnectionPool(this.settings);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.closeAll();
  }

  /** `fetch` com anti-SSRF, também usado pelo OAuth (descoberta e token). */
  get fetch(): McpClientSettings['fetch'] {
    return this.settings.fetch;
  }

  get redirectUrl(): string {
    return `${this.config.publicUrl}/api/v1/oauth/callback`;
  }

  /** Executa com a conexão reaproveitada do servidor (execuções). */
  use<T>(
    server: McpServerRow,
    credential: ResolvedCredential | undefined,
    fn: (connection: McpConnection) => Promise<T>,
  ): Promise<T> {
    // Credenciais estáticas: editar a credencial abre outra conexão. OAuth: a renovação do
    // token não deve derrubar a sessão.
    const credentialKey = credential
      ? `${credential.id}:${credential.type === 'mcpOAuth' ? '' : credential.updatedAt}`
      : '-';
    const key = `${server.id}:${server.updated_at.toISOString()}:${credentialKey}`;
    return this.pool.use(key, this.connectionConfig(server, credential), fn);
  }

  /** Conexão própria, fechada ao fim (teste e aprovação no catálogo). */
  async once<T>(
    server: McpServerRow,
    credential: ResolvedCredential | undefined,
    fn: (connection: McpConnection) => Promise<T>,
  ): Promise<T> {
    const connection = await McpConnection.open(this.connectionConfig(server, credential), {
      ...this.settings,
      onToolsListed: undefined,
    });
    try {
      return await fn(connection);
    } finally {
      await connection.close();
    }
  }

  /** Fecha as conexões do servidor (alterado, desativado ou com snapshot aceito). */
  async drop(serverId: string): Promise<void> {
    await this.pool.dropPrefix(`${serverId}:`);
  }

  /** Credencial do catálogo do servidor (a do nó prevalece, FR-007). */
  async serverCredential(server: McpServerRow): Promise<ResolvedCredential | undefined> {
    if (!server.credential_id) return undefined;
    return (await this.credentials.resolveById(server.credential_id)).credential;
  }

  oauthProvider(
    credential: ResolvedCredential,
    options: {
      interactive?: boolean;
      state?: string;
      codeVerifier?: string;
      ignoreTokens?: boolean;
    } = {},
  ): CredentialOAuthProvider {
    return new CredentialOAuthProvider(credential.data, {
      redirectUrl: this.redirectUrl,
      persist: async (patch) => {
        await this.credentials.patchData(credential.id, patch);
      },
      ...options,
    });
  }

  private connectionConfig(
    server: McpServerRow,
    credential: ResolvedCredential | undefined,
  ): McpConnectionConfig {
    const base = { serverId: server.id, transport: server.transport, url: server.url };
    if (!credential) return base;
    switch (credential.type) {
      case 'mcpBearer':
        return { ...base, headers: { authorization: `Bearer ${String(credential.data.token)}` } };
      case 'mcpHeaders':
        return { ...base, headers: Object.fromEntries(mcpHeaderLines(credential.data.headers)) };
      case 'mcpOAuth':
        return { ...base, authProvider: this.oauthProvider(credential) };
      default:
        throw new McpConfigurationError(
          `Credencial do tipo ${credential.type} não serve para servidores MCP`,
        );
    }
  }

  /** FR-003: grava (ou limpa) a divergência entre o snapshot aprovado e as tools anunciadas. */
  async compareSnapshot(serverId: string, tools: McpToolDefinition[]): Promise<void> {
    try {
      const row = await this.db
        .selectFrom('mcp_servers')
        .select(['tools_snapshot', 'snapshot_pending_diff', 'status'])
        .where('id', '=', serverId)
        .executeTakeFirst();
      if (!row?.tools_snapshot || row.status === 'pending') return;
      const diff = snapshotDiff(row.tools_snapshot as McpToolsSnapshot, tools);
      const current = row.snapshot_pending_diff as McpSnapshotDiff | null;
      if (sameChanges(current, diff)) return;
      await this.db
        .updateTable('mcp_servers')
        .set({ snapshot_pending_diff: diff ? JSON.stringify(diff) : null })
        .where('id', '=', serverId)
        .execute();
      if (diff) {
        this.logger.warn(
          `Servidor MCP ${serverId}: tools divergentes do snapshot aprovado (${diff.changes
            .map((c) => `${c.name}: ${c.kind}`)
            .join(', ')})`,
        );
      }
    } catch (error) {
      this.logger.warn(`Comparação do snapshot MCP falhou: ${String(error)}`);
    }
  }
}

function sameChanges(a: McpSnapshotDiff | null, b: McpSnapshotDiff | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a.changes) === JSON.stringify(b.changes);
}
