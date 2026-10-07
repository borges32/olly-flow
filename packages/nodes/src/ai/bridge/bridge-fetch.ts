import type { ResolvedCredential } from '../../credentials/definitions.js';
import {
  BRIDGE_USER_AGENT,
  type BridgeLoginFetch,
  type BridgeTokenManager,
} from './token-manager.js';

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

/** Motivo de uma resposta de erro: `mensagem`, `message`, `detail` ou `error`, ou o texto. */
function errorReason(text: string): string {
  try {
    const body = JSON.parse(text) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      for (const key of ['mensagem', 'message', 'detail', 'error']) {
        const value = record[key];
        if (typeof value === 'string' && value) return value;
        if (value && typeof value === 'object') {
          const nested = (value as Record<string, unknown>).message;
          return typeof nested === 'string' ? nested : JSON.stringify(value).slice(0, 300);
        }
      }
    }
  } catch {
    // Não é JSON (ex.: página do WAF): usa o texto.
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/**
 * Resposta 401/403 que persistiu depois do novo login: o SDK da OpenAI usa `error.message` do
 * corpo na mensagem do erro, então ela passa a dizer o endereço, o motivo e o que conferir.
 */
async function rejection(response: Response, url: string): Promise<Response> {
  const text = await response.text().catch(() => '');
  const reason = errorReason(text);
  const hint =
    response.status === 401
      ? 'O token foi recusado mesmo depois de um novo login: confira a credencial da Bridge.'
      : 'O usuário de serviço não tem acesso a este modelo ou endereço: confira o nome do modelo (o alias cadastrado na Bridge), as permissões do projeto do usuário de serviço e a URL base da credencial. Sem motivo no corpo, o bloqueio pode ser de um proxy ou WAF da rede.';
  const message = `A Bridge recusou a chamada (${String(response.status)}) em POST ${url}${reason ? `: ${reason}` : ''}. ${hint}`;
  return new Response(JSON.stringify({ error: { message } }), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}

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
    // Só os cabeçalhos do exemplo da Bridge, mais `accept` e o agente da plataforma.
    for (const name of [...headers.keys()]) {
      if (name.startsWith('x-stainless-')) headers.delete(name);
    }
    headers.set('user-agent', BRIDGE_USER_AGENT);
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
    const retried = await call(input, request, await token(signal));
    return REJECTED.has(retried.status) ? rejection(retried, urlOf(input)) : retried;
  };
}
