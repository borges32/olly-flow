import type { ResolvedCredential } from '../../credentials/definitions.js';

/** Duração padrão do token quando o `exp` não é legível (spec 016, FR-004). */
export const BRIDGE_DEFAULT_TOKEN_TTL_MS = 20 * 60_000;
const DEFAULT_SKEW_SECONDS = 60;
const ERROR_SNIPPET = 500;

/** O mínimo de `fetch` usado no login: serve ao `fetch` global e ao do `HttpGuard`. */
export type BridgeLoginFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal | null;
  },
) => Promise<{ ok: boolean; status: number; statusText?: string; text(): Promise<string> }>;

interface CacheEntry {
  token?: string;
  /** Epoch em ms a partir do qual o token é renovado. */
  renewAt: number;
  /** Login em andamento, compartilhado pelas chamadas simultâneas (NFR-001). */
  pending?: Promise<string>;
}

/** `exp` do JWT em ms, lido sem verificar a assinatura (a plataforma consome o token). */
export function jwtExpiration(token: string): number | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof parsed.exp === 'number' && Number.isFinite(parsed.exp)
      ? parsed.exp * 1000
      : undefined;
  } catch {
    return undefined;
  }
}

const field = (data: Record<string, unknown>, name: string): string => {
  const value = data[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Credencial Bridge: informe o campo "${name}"`);
  }
  return value.trim();
};

/**
 * Login de serviço na Bridge (FR-004): `POST tokenUrl { identificador, senha }` → `{ token }`.
 * A mensagem de erro traz o status e um trecho da resposta, nunca a senha (a API ainda mascara).
 */
export async function bridgeLogin(
  credential: ResolvedCredential,
  fetchFn: BridgeLoginFetch,
  signal?: AbortSignal,
): Promise<{ token: string; renewAt: number }> {
  const data = credential.data;
  const response = await fetchFn(field(data, 'tokenUrl'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      identificador: field(data, 'identificador'),
      senha: field(data, 'senha'),
    }),
    signal: signal ?? null,
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    const status = `${String(response.status)}${response.statusText ? ` ${response.statusText}` : ''}`;
    throw new Error(
      `Login na Bridge falhou com status ${status}${text ? `: ${text.slice(0, ERROR_SNIPPET)}` : ''}`,
    );
  }
  let token: unknown;
  try {
    token = (JSON.parse(text) as { token?: unknown }).token;
  } catch {
    token = undefined;
  }
  if (typeof token !== 'string' || !token) {
    throw new Error('A resposta do login da Bridge não tem o campo "token"');
  }
  const skew = Number(data.tokenSkewSeconds);
  const skewMs = (Number.isFinite(skew) && skew >= 0 ? skew : DEFAULT_SKEW_SECONDS) * 1000;
  const expiresAt = jwtExpiration(token) ?? Date.now() + BRIDGE_DEFAULT_TOKEN_TTL_MS;
  return { token, renewAt: expiresAt - skewMs };
}

/**
 * Tokens da Bridge em memória, por processo (spec 016, FR-004, plan §3): a chave é a credencial
 * e a sua versão (`updatedAt`), então uma credencial alterada faz um novo login. O token é
 * renovado antes do `exp` menos a margem, e os logins simultâneos viram um só.
 */
export class BridgeTokenManager {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  private static key(credential: ResolvedCredential): string {
    return `${credential.id}|${credential.updatedAt}`;
  }

  async getToken(
    credential: ResolvedCredential,
    fetchFn: BridgeLoginFetch,
    signal?: AbortSignal,
  ): Promise<string> {
    const key = BridgeTokenManager.key(credential);
    const entry = this.cache.get(key);
    if (entry?.token && entry.renewAt > this.now()) return entry.token;
    if (entry?.pending) return entry.pending;
    // Versões anteriores da mesma credencial não servem mais.
    for (const other of this.cache.keys()) {
      if (other !== key && other.startsWith(`${credential.id}|`)) this.cache.delete(other);
    }
    const pending = bridgeLogin(credential, fetchFn, signal).then(
      ({ token, renewAt }) => {
        this.cache.set(key, { token, renewAt });
        return token;
      },
      (error: unknown) => {
        this.cache.delete(key);
        throw error;
      },
    );
    this.cache.set(key, { renewAt: 0, pending });
    return pending;
  }

  /**
   * Descarta o token recusado (FR-005). Só remove se ainda for o mesmo: outra chamada pode já
   * ter obtido um novo.
   */
  invalidate(credential: ResolvedCredential, token: string): void {
    const key = BridgeTokenManager.key(credential);
    if (this.cache.get(key)?.token === token) this.cache.delete(key);
  }
}
