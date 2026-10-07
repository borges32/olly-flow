import pg from 'pg';
import { bridgeLogin } from '../ai/bridge/token-manager.js';
import { applyHttpCredential, OAuth2TokenCache } from '../http/auth.js';
import { connectionConfig } from '../postgres/pool.js';
import type { HttpGuard } from '../shared/http-guard.js';
import { Headers } from 'undici';
import type { ResolvedCredential } from './definitions.js';

export interface CredentialTestResult {
  ok: boolean;
  message: string;
}

export class CredentialTestInputError extends Error {
  override name = 'CredentialTestInputError';
}

const TEST_TIMEOUT_MS = 15_000;

/**
 * Testa uma credencial (spec 004, FR-005, plan §10): Postgres roda `SELECT 1`; OAuth2 obtém um
 * token novo; a Bridge faz o login de serviço (spec 016); os tipos HTTP genéricos fazem um GET
 * autenticado na URL informada, pelo filtro anti-SSRF. A mensagem pode citar o servidor, mas nunca o segredo (a API ainda mascara).
 */
export async function testCredential(
  credential: ResolvedCredential,
  deps: { guard: HttpGuard },
  options: { url?: string } = {},
): Promise<CredentialTestResult> {
  const signal = AbortSignal.timeout(TEST_TIMEOUT_MS);
  const fail = (error: unknown): CredentialTestResult => ({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  });
  if (credential.type === 'postgres') {
    const client = new pg.Client(connectionConfig(credential.data));
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { ok: true, message: 'Conexão bem-sucedida' };
    } catch (error) {
      return fail(error);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  if (credential.type === 'oauth2ClientCredentials') {
    try {
      await new OAuth2TokenCache().getToken(credential, deps.guard, signal);
      return { ok: true, message: 'Token obtido com sucesso' };
    } catch (error) {
      return fail(error);
    }
  }
  if (credential.type === 'bridgeApi') {
    // Spec 016, FR-002: o mesmo login da execução, com as opções da Bridge (TLS e redes internas).
    try {
      await bridgeLogin(
        credential,
        (url, init) =>
          deps.guard.fetch(url, {
            ...init,
            signal: init.signal ?? signal,
            insecureTls: credential.data.allowUnauthorizedCerts === true,
            allowPrivateNetworks: true,
          }),
        signal,
      );
      return { ok: true, message: 'Login bem-sucedido' };
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      return fail(cause instanceof Error ? cause : error);
    }
  }
  if (credential.type === 'agentixApi') {
    // Spec 016, plan §1: como no N8N, o Agentix não tem um endpoint só de validação.
    throw new CredentialTestInputError(
      'A credencial Agentix é validada na primeira execução do nó (o Agentix não tem um endpoint só de validação)',
    );
  }
  if (credential.type.startsWith('mcp')) {
    // Spec 010: a credencial MCP é testada pela conexão com o servidor (catálogo MCP) ou, no
    // OAuth, pelo botão "Conectar".
    throw new CredentialTestInputError(
      'Credenciais MCP são testadas pelo teste do servidor no catálogo MCP (ou "Conectar", no OAuth)',
    );
  }
  if (!options.url) {
    throw new CredentialTestInputError('Informe uma URL para testar esta credencial');
  }
  try {
    const url = new URL(options.url);
    const headers = new Headers();
    await applyHttpCredential(
      credential,
      { headers, url },
      { guard: deps.guard, oauth: new OAuth2TokenCache(), signal },
    );
    const response = await deps.guard.fetch(url, { headers, signal });
    await response.body?.cancel();
    return response.ok
      ? { ok: true, message: `Resposta ${response.status}` }
      : { ok: false, message: `A URL respondeu com status ${response.status}` };
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return fail(cause instanceof Error ? cause : error);
  }
}
