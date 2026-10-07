import type { ResolvedCredential } from '../../credentials/definitions.js';
import type { BridgeLoginFetch, BridgeTokenManager } from './token-manager.js';

export interface BridgeFetchOptions {
  credential: ResolvedCredential;
  tokens: BridgeTokenManager;
  /** `fetch` com anti-SSRF e as opções da credencial (`AiGateway.fetchFor`). */
  fetch: typeof fetch;
  /** A Bridge lê o modelo do endereço: o `model` só vai no corpo com esta opção (FR-003). */
  sendModelInBody: boolean;
  /** Cada token obtido entra no mascaramento (FR-014). */
  onToken: (token: string) => void;
}

/** Tira o `model` do corpo JSON; outro corpo segue igual. */
function withoutModel(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    const payload = JSON.parse(body) as unknown;
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'model' in payload) {
      return JSON.stringify(
        Object.fromEntries(
          Object.entries(payload as Record<string, unknown>).filter(([key]) => key !== 'model'),
        ),
      );
    }
  } catch {
    // Não é JSON: segue sem mudança.
  }
  return body;
}

const REJECTED = new Set([401, 403]);

/**
 * `fetch` entregue ao cliente OpenAI do Bridge Chat Model (spec 016, FR-003 a FR-005, plan §3):
 * põe o token em cada chamada (uma execução longa não morre com o token vencido), tira o
 * `model` do corpo e, em 401/403, descarta o token, faz um novo login e repete uma vez.
 */
export function createBridgeFetch(options: BridgeFetchOptions): typeof fetch {
  const login = options.fetch as unknown as BridgeLoginFetch;
  const token = async (signal?: AbortSignal) => {
    const value = await options.tokens.getToken(options.credential, login, signal);
    options.onToken(value);
    return value;
  };
  const call = (input: Parameters<typeof fetch>[0], init: RequestInit, value: string) => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${value}`);
    if (!headers.has('content-type') && init.body !== undefined && init.body !== null) {
      headers.set('content-type', 'application/json');
    }
    return options.fetch(input, { ...init, headers });
  };
  return async (input, init = {}) => {
    const request: RequestInit = options.sendModelInBody
      ? init
      : { ...init, body: withoutModel(init.body) as RequestInit['body'] };
    const signal = request.signal ?? undefined;
    const first = await token(signal);
    const response = await call(input, request, first);
    if (!REJECTED.has(response.status)) return response;
    await response.body?.cancel();
    options.tokens.invalidate(options.credential, first);
    return call(input, request, await token(signal));
  };
}
