import type { Headers } from 'undici';
import type { ResolvedCredential } from '../credentials/definitions.js';
import { NodeExecutionError } from '../errors.js';
import type { HttpGuard } from '../shared/http-guard.js';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Margem antes do vencimento em que o token é renovado (plan §3). */
const EXPIRY_MARGIN_MS = 30_000;

/**
 * Tokens de OAuth2 client credentials em memória, por credencial e versão (`id:updatedAt`),
 * até `expires_in - 30 s` (spec 004, FR-004, plan §3). Alterar a credencial invalida o token.
 */
export class OAuth2TokenCache {
  private readonly tokens = new Map<string, CachedToken>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly now: () => number = Date.now) {}

  async getToken(
    credential: ResolvedCredential,
    guard: HttpGuard,
    signal?: AbortSignal,
  ): Promise<string> {
    const key = `${credential.id}:${credential.updatedAt}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.token;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const request = this.fetchToken(credential.data, guard, signal)
      .then(({ token, expiresIn }) => {
        if (expiresIn > 0) {
          this.tokens.set(key, {
            token,
            expiresAt: this.now() + expiresIn * 1000 - EXPIRY_MARGIN_MS,
          });
        }
        return token;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private async fetchToken(
    data: Record<string, unknown>,
    guard: HttpGuard,
    signal?: AbortSignal,
  ): Promise<{ token: string; expiresIn: number }> {
    const form = new URLSearchParams({ grant_type: 'client_credentials' });
    if (str(data.scope)) form.set('scope', str(data.scope));
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    if (data.authentication === 'body') {
      form.set('client_id', str(data.clientId));
      form.set('client_secret', str(data.clientSecret));
    } else {
      const basic = Buffer.from(
        `${encodeURIComponent(str(data.clientId))}:${encodeURIComponent(str(data.clientSecret))}`,
      ).toString('base64');
      headers.authorization = `Basic ${basic}`;
    }
    const response = await guard.fetch(str(data.tokenUrl), {
      method: 'POST',
      headers,
      body: form.toString(),
      ...(signal && { signal }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    // O corpo de erro do servidor de autorização não entra na mensagem: pode ecoar o segredo.
    if (!response.ok || typeof body.access_token !== 'string') {
      throw new NodeExecutionError(
        `Não foi possível obter o token OAuth2 (status ${response.status})`,
        { httpCode: response.status, description: str(body.error) || undefined },
      );
    }
    return { token: body.access_token, expiresIn: Number(body.expires_in ?? 0) };
  }
}

export interface AuthDeps {
  guard: HttpGuard;
  oauth: OAuth2TokenCache;
  signal?: AbortSignal;
  /** Registra segredos derivados para o mascaramento (ex.: token obtido). */
  registerSecret?: (value: string) => void;
}

/** Aplica a credencial HTTP à requisição (cabeçalho ou query). */
export async function applyHttpCredential(
  credential: ResolvedCredential,
  target: { headers: Headers; url: URL },
  deps: AuthDeps,
): Promise<void> {
  const { data } = credential;
  switch (credential.type) {
    case 'httpBearer':
      target.headers.set('authorization', `Bearer ${str(data.token)}`);
      return;
    case 'httpBasic':
      target.headers.set(
        'authorization',
        `Basic ${Buffer.from(`${str(data.user)}:${str(data.password)}`).toString('base64')}`,
      );
      return;
    case 'httpHeaderAuth':
      target.headers.set(str(data.name), str(data.value));
      return;
    case 'httpQueryAuth':
      target.url.searchParams.set(str(data.name), str(data.value));
      return;
    case 'oauth2ClientCredentials': {
      const token = await deps.oauth.getToken(credential, deps.guard, deps.signal);
      deps.registerSecret?.(token);
      target.headers.set('authorization', `Bearer ${token}`);
      return;
    }
    default:
      throw new NodeExecutionError(`Credencial do tipo ${credential.type} não serve para HTTP`);
  }
}
