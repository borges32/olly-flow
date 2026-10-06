import { randomUUID } from 'node:crypto';
import {
  McpAuthRequiredError,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from '@olly/mcp-client';

export interface OAuthProviderOptions {
  /** `${OLLY_PUBLIC_URL}/api/v1/oauth/callback`. */
  redirectUrl: string;
  /** Grava campos na credencial (cifrados). */
  persist(patch: Record<string, unknown>): Promise<void>;
  /** "Conectar": guarda a URL de autorização em vez de falhar. */
  interactive?: boolean;
  state?: string;
  codeVerifier?: string;
  /** "Conectar" ignora os tokens atuais (nova autorização). */
  ignoreTokens?: boolean;
}

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

/**
 * OAuth 2.1 do servidor MCP conforme a especificação (spec 010, FR-007, plan §4) sobre uma
 * credencial `mcpOAuth`: o SDK faz a descoberta (`oauth-protected-resource` → servidor de
 * autorização), o registro dinâmico quando não há Client ID, o PKCE e a renovação do token; aqui
 * os tokens e o cliente registrado são guardados cifrados na credencial.
 */
export class CredentialOAuthProvider implements OAuthClientProvider {
  /** URL de autorização gerada no "Conectar". */
  authorizationUrl?: URL;
  private verifier?: string;
  private readonly stateValue: string;

  constructor(
    private data: Record<string, unknown>,
    private readonly options: OAuthProviderOptions,
  ) {
    this.verifier = options.codeVerifier;
    this.stateValue = options.state ?? randomUUID();
  }

  get redirectUrl(): string {
    return this.options.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    const secret = str(this.data.clientSecret);
    const scope = str(this.data.scope);
    return {
      client_name: 'Olly Flow',
      redirect_uris: [this.options.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: secret ? 'client_secret_post' : 'none',
      ...(scope && { scope }),
    };
  }

  state(): string {
    return this.stateValue;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const clientId = str(this.data.clientId);
    if (clientId) {
      const secret = str(this.data.clientSecret);
      return { client_id: clientId, ...(secret && { client_secret: secret }) };
    }
    const registered = str(this.data.registeredClient);
    return registered ? (JSON.parse(registered) as OAuthClientInformationMixed) : undefined;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await this.save({ registeredClient: JSON.stringify(info) });
  }

  tokens(): OAuthTokens | undefined {
    if (this.options.ignoreTokens) return undefined;
    const access = str(this.data.accessToken);
    if (!access) return undefined;
    const refresh = str(this.data.refreshToken);
    const expiresAt = str(this.data.expiresAt);
    const expiresIn = expiresAt
      ? Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
      : undefined;
    return {
      access_token: access,
      token_type: 'Bearer',
      ...(refresh && { refresh_token: refresh }),
      ...(expiresIn !== undefined && { expires_in: expiresIn }),
    };
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.save({
      accessToken: tokens.access_token,
      // Sem rotação do refresh token, o atual continua valendo.
      refreshToken: tokens.refresh_token ?? str(this.data.refreshToken) ?? '',
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : '',
    });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    if (!this.options.interactive) {
      throw new McpAuthRequiredError(
        'A credencial OAuth do servidor MCP precisa ser conectada (botão "Conectar" na credencial)',
      );
    }
    this.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier)
      throw new McpAuthRequiredError('Autorização OAuth expirada; conecte de novo');
    return this.verifier;
  }

  get pendingCodeVerifier(): string | undefined {
    return this.verifier;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'tokens')
      await this.save({ accessToken: '', refreshToken: '' });
    if (scope === 'all' || scope === 'client') await this.save({ registeredClient: '' });
    if (scope === 'verifier') this.verifier = undefined;
  }

  private async save(patch: Record<string, unknown>): Promise<void> {
    this.data = { ...this.data, ...patch };
    await this.options.persist(patch);
  }
}
