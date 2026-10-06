import { readFile } from 'node:fs/promises';
import { CredentialCryptoError, type KeyProvider } from './crypto.js';

/**
 * Configuração do Vault (spec 009, plan §1). Nenhum token fica em código ou configuração: a API
 * se autentica por AppRole (role/secret id) ou pela conta de serviço do Kubernetes.
 */
export interface VaultOptions {
  address: string;
  auth: 'approle' | 'kubernetes';
  roleId?: string;
  secretId?: string;
  /** Papel do método `kubernetes`. */
  kubernetesRole?: string;
  kubernetesTokenPath?: string;
  transitMount: string;
  transitKey: string;
  /** Namespace do Vault Enterprise/HCP (cabeçalho `X-Vault-Namespace`). */
  namespace?: string;
  timeoutMs?: number;
}

const DEFAULT_K8S_TOKEN = '/var/run/secrets/kubernetes.io/serviceaccount/token';
/** Renova o token antes de expirar. */
const TOKEN_MARGIN_MS = 30_000;

class VaultHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Chave mestra no Vault Transit (FR-001): a KEK nunca sai do Vault. `wrap` = `transit/encrypt`,
 * `unwrap` = `transit/decrypt`; a versão da chave vem do próprio ciphertext (`vault:vN:...`), de
 * modo que, depois de `transit/keys/<key>/rotate`, as DEKs novas já usam a versão nova.
 */
export class VaultTransitKeyProvider implements KeyProvider {
  readonly id = 'vault';
  private token?: { value: string; expiresAt: number };
  private login?: Promise<string>;

  constructor(private readonly options: VaultOptions) {}

  async currentKeyVersion(): Promise<number> {
    const res = await this.call<{ data: { latest_version: number } }>(
      'GET',
      `${this.options.transitMount}/keys/${encodeURIComponent(this.options.transitKey)}`,
    );
    return res.data.latest_version;
  }

  async wrap(dek: Buffer): Promise<{ wrapped: Buffer; keyVersion: number }> {
    const res = await this.call<{ data: { ciphertext: string } }>(
      'POST',
      `${this.options.transitMount}/encrypt/${encodeURIComponent(this.options.transitKey)}`,
      { plaintext: dek.toString('base64') },
    );
    const ciphertext = res.data.ciphertext;
    const version = /^vault:v(\d+):/.exec(ciphertext)?.[1];
    if (!version) throw new CredentialCryptoError('Resposta inesperada do Vault Transit');
    return { wrapped: Buffer.from(ciphertext, 'utf8'), keyVersion: Number(version) };
  }

  async unwrap(wrapped: Buffer, keyVersion: number): Promise<Buffer> {
    const ciphertext = wrapped.toString('utf8');
    if (!ciphertext.startsWith(`vault:v${keyVersion}:`)) {
      throw new CredentialCryptoError('Envelope não corresponde à versão da chave do Vault');
    }
    const res = await this.call<{ data: { plaintext: string } }>(
      'POST',
      `${this.options.transitMount}/decrypt/${encodeURIComponent(this.options.transitKey)}`,
      { ciphertext },
    );
    return Buffer.from(res.data.plaintext, 'base64');
  }

  /** Cria uma nova versão da chave no Vault (exige a política `rotate`; ver docs/governanca.md). */
  async rotateKey(): Promise<number> {
    await this.call(
      'POST',
      `${this.options.transitMount}/keys/${encodeURIComponent(this.options.transitKey)}/rotate`,
      {},
    );
    return this.currentKeyVersion();
  }

  /** Disponível e autenticável (usado no `/health`). */
  async isReachable(): Promise<boolean> {
    try {
      await this.currentKeyVersion();
      return true;
    } catch {
      return false;
    }
  }

  private async call<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const token = await this.getToken();
    try {
      return await this.request<T>(method, path, body, token);
    } catch (error) {
      // Token revogado ou expirado antes do previsto: um novo login e uma nova tentativa.
      if (retry && error instanceof VaultHttpError && error.status === 403) {
        this.token = undefined;
        return this.call<T>(method, path, body, false);
      }
      throw toCryptoError(error);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    token?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers['x-vault-token'] = token;
    if (this.options.namespace) headers['x-vault-namespace'] = this.options.namespace;
    const res = await fetch(`${this.options.address.replace(/\/+$/, '')}/v1/${path}`, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
    });
    if (!res.ok) {
      // O corpo de erro do Vault traz só mensagens (`errors`), nunca o segredo enviado.
      const text = await res.text().catch(() => '');
      let detail: string;
      try {
        detail = (JSON.parse(text) as { errors?: string[] }).errors?.join('; ') ?? '';
      } catch {
        detail = '';
      }
      throw new VaultHttpError(
        res.status,
        `Vault respondeu ${res.status}${detail ? `: ${detail}` : ''}`,
      );
    }
    return (res.status === 204 ? {} : await res.json()) as T;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    this.login ??= this.authenticate().finally(() => {
      this.login = undefined;
    });
    return this.login;
  }

  private async authenticate(): Promise<string> {
    const o = this.options;
    let res: { auth: { client_token: string; lease_duration: number } };
    try {
      if (o.auth === 'approle') {
        if (!o.roleId || !o.secretId) {
          throw new CredentialCryptoError('Vault AppRole sem role id ou secret id');
        }
        res = await this.request('POST', 'auth/approle/login', {
          role_id: o.roleId,
          secret_id: o.secretId,
        });
      } else {
        const jwt = (await readFile(o.kubernetesTokenPath ?? DEFAULT_K8S_TOKEN, 'utf8')).trim();
        res = await this.request('POST', 'auth/kubernetes/login', {
          role: o.kubernetesRole,
          jwt,
        });
      }
    } catch (error) {
      throw toCryptoError(error, 'Falha ao autenticar no Vault');
    }
    const ttlMs = Math.max(res.auth.lease_duration * 1000 - TOKEN_MARGIN_MS, 5000);
    this.token = { value: res.auth.client_token, expiresAt: Date.now() + ttlMs };
    return res.auth.client_token;
  }
}

function toCryptoError(error: unknown, prefix = 'Vault indisponível'): CredentialCryptoError {
  if (error instanceof CredentialCryptoError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new CredentialCryptoError(`${prefix}: ${message}`, { cause: error });
}
