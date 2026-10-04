/**
 * Smoke test do ambiente local (FR-017). Uso, em máquina limpa:
 *   docker compose up -d && pnpm smoke
 * Aguarda os serviços, aplica migrations e seed, sobe a API compilada se ela não estiver
 * no ar e verifica health, login no IdP de desenvolvimento e /api/v1/me.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const envFile = existsSync(`${root}/.env`) ? `${root}/.env` : `${root}/.env.example`;
const env: Record<string, string> = {
  ...(parseEnv(readFileSync(envFile, 'utf8')) as Record<string, string>),
  ...(process.env as Record<string, string>),
};
const apiUrl = `http://localhost:${env.API_PORT ?? '3000'}`;
const issuer = env.OIDC_ISSUER_URL ?? 'http://localhost:8080/realms/olly';
const TIMEOUT_MS = 180_000;

let api: ChildProcess | undefined;

function ok(message: string): void {
  console.log(`✔ ${message}`);
}

async function fetchStatus(url: string, init?: RequestInit): Promise<number> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
    return res.status;
  } catch {
    return 0;
  }
}

async function waitFor(what: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Tempo esgotado aguardando ${what}`);
}

function pnpm(...args: string[]): boolean {
  return spawnSync('pnpm', args, { cwd: root, env, stdio: 'pipe' }).status === 0;
}

async function main(): Promise<void> {
  console.log(`Smoke test (env: ${envFile.replace(root, '')})`);

  await waitFor('PostgreSQL (migrations)', () => Promise.resolve(pnpm('db:migrate')));
  if (!pnpm('db:seed')) throw new Error('Falha no seed de papéis');
  ok('FR-002/FR-009: PostgreSQL no ar, migrations e seed aplicados');

  await waitFor('IdP de desenvolvimento', async () => {
    return (await fetchStatus(`${issuer}/.well-known/openid-configuration`)) === 200;
  });
  ok('FR-002: IdP de desenvolvimento no ar');

  const s3 = env.S3_ENDPOINT ?? 'http://localhost:9000';
  await waitFor(
    'object storage',
    async () => (await fetchStatus(`${s3}/minio/health/live`)) === 200,
  );
  ok('FR-002: object storage no ar');

  if ((await fetchStatus(`${apiUrl}/health`)) === 0) {
    const main = `${root}/apps/api/dist/main.js`;
    if (!existsSync(main)) throw new Error('API não compilada: rode `pnpm build` antes do smoke');
    api = spawn(process.execPath, [main], {
      cwd: root,
      env: { ...env, LOG_LEVEL: 'warn' },
      stdio: 'inherit',
    });
    console.log(`  (API iniciada pelo smoke em ${apiUrl})`);
  }

  let health: unknown;
  await waitFor('/health com todas as dependências', async () => {
    try {
      const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(5000) });
      health = await res.json();
      return res.status === 200 && (health as { status?: string }).status === 'ok';
    } catch {
      return false;
    }
  });
  ok(`FR-012: GET /health = 200 ${JSON.stringify(health)}`);

  const tokenRes = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: env.OIDC_CLIENT_ID ?? 'olly-web',
      username: 'admin@olly.local',
      password: 'olly123',
      scope: 'openid',
    }),
  });
  if (!tokenRes.ok) throw new Error(`Password grant falhou: HTTP ${tokenRes.status}`);
  const { access_token: token } = (await tokenRes.json()) as { access_token: string };
  ok('FR-003: token obtido para admin@olly.local (password grant, somente dev)');

  const anonymous = await fetchStatus(`${apiUrl}/api/v1/me`);
  if (anonymous !== 401)
    throw new Error(`/api/v1/me sem token devolveu ${anonymous}, esperado 401`);
  ok('FR-004: GET /api/v1/me sem token = 401');

  const meRes = await fetch(`${apiUrl}/api/v1/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const me = (await meRes.json()) as { email?: string; permissions?: { global?: string[] } };
  const globalPermissions = me.permissions?.global ?? [];
  if (
    meRes.status !== 200 ||
    me.email !== 'admin@olly.local' ||
    !globalPermissions.includes('user:manage')
  ) {
    throw new Error(`GET /api/v1/me inesperado: ${meRes.status} ${JSON.stringify(me)}`);
  }
  ok(`FR-006: GET /api/v1/me = 200 (${me.email}, ${globalPermissions.length} permissões globais)`);

  console.log('\nFR-017: smoke test do ambiente passou.');
}

main()
  .catch((error: unknown) => {
    console.error(`✘ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    api?.kill('SIGTERM');
  });
