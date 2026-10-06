import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcpTestServer, type McpTestServer } from '@olly/mcp-test-server';
import type {
  CredentialSummary,
  McpOAuthAuthorizeResponse,
  McpOAuthStatus,
  McpServer,
  ProjectSummary,
} from '@olly/shared-types';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { mcpWorkflow } from '../testing/mcp.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * IdP de desenvolvimento do compose (o serviço que importa `olly-realm.json`, com o client
 * `olly-mcp` da spec 010): imagem, comando e realm vêm do `docker-compose.yml`, fonte única. O
 * código das apps não cita o fornecedor do IdP (spec 001, FR-008).
 */
function devIdp() {
  const compose = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf8');
  const block = compose
    .split(/\n(?= {2}[a-z][\w-]*:\n)/)
    .find((b) => b.includes('olly-realm.json'));
  const image = block && /^\s+image: (\S+)$/m.exec(block)?.[1];
  const command = block && /^\s+command: \[(.+)\]$/m.exec(block)?.[1];
  const volume = block && /^\s+- \.\/([^\s:]+olly-realm\.json):(\S+?)(?::ro)?$/m.exec(block);
  if (!image || !command || !volume?.[1] || !volume[2]) {
    throw new Error('Serviço do IdP de desenvolvimento não encontrado no docker-compose.yml');
  }
  return {
    image,
    command: command.split(',').map((c) => c.trim().replace(/^'|'$/g, '')),
    realm: { source: resolve(ROOT, volume[1]), target: volume[2] },
  };
}

let idp: StartedTestContainer;
let issuer: string;
let ctx: TestContext;
let mcp: McpTestServer;
let admin: TestUser, editor: TestUser;
let project: ProjectSummary;

beforeAll(async () => {
  const dev = devIdp();
  idp = await new GenericContainer(dev.image)
    .withCommand(dev.command)
    .withEnvironment({
      KC_BOOTSTRAP_ADMIN_USERNAME: 'admin',
      KC_BOOTSTRAP_ADMIN_PASSWORD: 'admin',
      KC_HEALTH_ENABLED: 'true',
    })
    .withCopyFilesToContainer([dev.realm])
    .withExposedPorts(8080, 9000)
    .withWaitStrategy(Wait.forHttp('/health/ready', 9000))
    .withStartupTimeout(240_000)
    .start();
  issuer = `http://localhost:${idp.getMappedPort(8080)}/realms/olly`;
  // Servidor MCP protegido: aceita só JWTs do IdP com a audience `olly-mcp-test`.
  mcp = await startMcpTestServer({ auth: { kind: 'oauth', issuer, audience: 'olly-mcp-test' } });
  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1', '::1', 'localhost'], maxResponseBytes: 1024 * 1024 },
  });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@oauth.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@oauth.local' });
  project = (await admin.call('POST', '/projects', { name: 'OAuth' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
}, 300_000);
afterAll(async () => {
  await ctx.close();
  await mcp.close();
  await idp.stop();
});

/** O navegador do usuário: abre a URL de autorização, faz login e devolve o redirect. */
async function browserLogin(authorizationUrl: string, user: string): Promise<URL> {
  const cookies = new Map<string, string>();
  const keep = (res: Response) => {
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, ...value] = (pair ?? '').split('=');
      if (name) cookies.set(name.trim(), value.join('='));
    }
  };
  const header = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const page = await fetch(authorizationUrl, { redirect: 'manual' });
  keep(page);
  const html = await page.text();
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1];
  if (!action) throw new Error(`formulário de login não encontrado (${page.status})`);
  const login = await fetch(action.replaceAll('&amp;', '&'), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: header() },
    body: new URLSearchParams({ username: user, password: 'olly123', credentialId: '' }),
  });
  const location = login.headers.get('location');
  if (login.status !== 302 || !location) throw new Error(`login falhou: ${login.status}`);
  return new URL(location);
}

describe('spec 010 — FR-007/SC-006: OAuth 2.1 conforme a especificação MCP', () => {
  it('SC-006: "Conectar" autoriza no IdP, o servidor aceita o token e a renovação é automática', async () => {
    const credential = (
      await admin.call('POST', `/projects/${project.id}/credentials`, {
        name: 'MCP OAuth',
        type: 'mcpOAuth',
        data: { serverUrl: `${mcp.url}/mcp`, clientId: 'olly-mcp' },
      })
    ).json<CredentialSummary>();
    const server = (
      await admin.call('POST', '/mcp-servers', {
        name: 'Protegido',
        transport: 'streamableHttp',
        url: `${mcp.url}/mcp`,
        credentialId: credential.id,
      })
    ).json<McpServer>();

    // Antes de conectar, o servidor recusa e a aprovação não acontece.
    expect((await admin.call('POST', `/mcp-servers/${server.id}/approve`)).body).toContain(
      'precisa ser conectada',
    );
    expect(
      (
        await admin.call('GET', `/credentials/${credential.id}/oauth/status`)
      ).json<McpOAuthStatus>(),
    ).toMatchObject({ connected: false });

    // Descoberta (oauth-protected-resource → IdP) e Authorization Code + PKCE.
    const authorize = await admin.call('POST', `/credentials/${credential.id}/oauth/authorize`);
    expect(authorize.statusCode).toBe(200);
    const url = new URL(authorize.json<McpOAuthAuthorizeResponse>().authorizationUrl);
    expect(url.href.startsWith(`${issuer}/protocol/openid-connect/auth`)).toBe(true);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5173/api/v1/oauth/callback',
    );

    const redirect = await browserLogin(url.href, 'editor@olly.local');
    expect(redirect.searchParams.get('state')).toBe(url.searchParams.get('state'));
    const callback = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/oauth/callback${redirect.search}`,
    });
    expect(callback.body).toContain('Servidor MCP conectado');
    expect(callback.statusCode).toBe(200);
    // O `state` é de uso único.
    expect(
      (await ctx.app.inject({ method: 'GET', url: `/api/v1/oauth/callback${redirect.search}` }))
        .statusCode,
    ).toBe(400);

    const status = (
      await editor.call('GET', `/credentials/${credential.id}/oauth/status`)
    ).json<McpOAuthStatus>();
    expect(status.connected).toBe(true);
    expect(status.expiresAt).not.toBeNull();
    // Tokens nunca saem da API.
    const summary = (await admin.call('GET', `/credentials/${credential.id}`)).body;
    expect(summary).not.toContain('accessToken":"ey');
    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select(['action', 'user_id'])
      .where('entity_id', '=', credential.id)
      .where('action', '=', 'credential.oauth_connect')
      .executeTakeFirstOrThrow();
    expect(audit.user_id).toBe(admin.id);

    // Com o token, aprova e usa.
    expect((await admin.call('POST', `/mcp-servers/${server.id}/approve`)).statusCode).toBe(200);
    await admin.call('PUT', `/mcp-servers/${server.id}/policies`, {
      policies: [{ toolName: 'soma', allowed: true, destructive: false }],
    });
    const wf = await createWorkflow(
      editor,
      project.id,
      mcpWorkflow(server.id, { toolName: 'soma', arguments: { a: 20, b: 22 } }),
    );
    const first = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(first.status).toBe('success');
    const tokensBefore = mcp.acceptedTokens.length;
    expect(tokensBefore).toBeGreaterThan(0);

    // Token expirado: o servidor responde 401 e o cliente renova com o refresh token.
    const stored = async () =>
      (
        await ctx.database.db
          .selectFrom('credentials')
          .select('updated_at')
          .where('id', '=', credential.id)
          .executeTakeFirstOrThrow()
      ).updated_at.getTime();
    const updatedBefore = await stored();
    mcp.revokeAcceptedTokens();
    const second = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(second.status).toBe('success');
    expect(mcp.acceptedTokens.length).toBeGreaterThan(tokensBefore);
    // O token novo foi gravado (cifrado) na credencial.
    expect(await stored()).toBeGreaterThan(updatedBefore);
  });
});
