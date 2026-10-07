import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import type {
  AuthConfig,
  LocalSessionResponse,
  MeResponse,
  ProjectSummary,
} from '@olly/shared-types';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestContext, type TestContext } from '../testing/test-app.js';

/** Senha sentinela (SC-005): não pode aparecer em logs, respostas, auditoria ou banco em claro. */
const SENHA_ADMIN = 'sentinela-Admin-7c1e9b42';
const SENHA_NOVA = 'sentinela-Nova-3f8a0d17';

let ctx: TestContext;
const logs: string[] = [];
const responses: string[] = [];

/** Requisição sem autenticação (ou com o token informado). */
async function call(
  method: InjectOptions['method'],
  path: string,
  payload?: unknown,
  token?: string,
) {
  const res = await ctx.app.inject({
    method,
    url: `/api/v1${path}`,
    ...(token && { headers: { authorization: `Bearer ${token}` } }),
    ...(payload !== undefined && { payload: payload as InjectOptions['payload'] }),
  });
  responses.push(res.body);
  return res;
}

const login = (email: string, password: string) =>
  call('POST', '/auth/local/login', { email, password });

const audit = async (action: string) =>
  ctx.database.db.selectFrom('audit_log').selectAll().where('action', '=', action).execute();

beforeAll(async () => {
  const logStream = new Writable({
    write(chunk: Buffer, _enc, done) {
      logs.push(chunk.toString('utf8'));
      done();
    },
  });
  // FR-010: IdP desligado (o padrão da instalação).
  ctx = await startTestContext(
    {
      logLevel: 'trace',
      auth: {
        idpEnabled: false,
        sessionIdleMs: 8 * 3_600_000,
        sessionMaxMs: 24 * 3_600_000,
        loginMaxAttempts: 5,
        loginLockMs: 15 * 60_000,
      },
    },
    { logStream },
  );
});
afterAll(async () => {
  await ctx.close();
});

let adminToken = '';

describe('spec 014 — HU-1: primeiro usuário numa instalação nova', () => {
  it('FR-001/FR-010: sem usuários, a tela oferece o cadastro; o login pelo IdP está desligado', async () => {
    expect((await call('GET', '/auth/config')).json<AuthConfig>()).toEqual({
      setupRequired: true,
      idpEnabled: false,
    });
    // Token OIDC válido não entra com o IdP desligado.
    const oidc = await ctx.issuer.sign({ sub: 'x', email: 'x@olly.local' });
    const res = await call('GET', '/me', undefined, oidc);
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('Login pelo IdP desativado');
  });

  it('NFR-001: o cadastro aplica a política de senha', async () => {
    const res = await call('POST', '/auth/setup', {
      name: 'Ana',
      email: 'ana@olly.local',
      password: 'curta',
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('pelo menos 12 caracteres');
    expect((await call('GET', '/auth/config')).json<AuthConfig>().setupRequired).toBe(true);
  });

  it('FR-002/FR-003/SC-001/SC-002: só um cadastro vence, mesmo simultâneo; o primeiro usuário é admin global', async () => {
    const attempts = await Promise.all(
      ['ana', 'bia', 'caio', 'davi', 'eva'].map((n) =>
        call('POST', '/auth/setup', {
          name: n,
          email: `${n}@olly.local`,
          password: SENHA_ADMIN,
        }),
      ),
    );
    const ok = attempts.filter((r) => r.statusCode === 201);
    expect(ok).toHaveLength(1);
    expect(attempts.filter((r) => r.statusCode === 409)).toHaveLength(4);
    expect(attempts.find((r) => r.statusCode === 409)?.body).toContain('já foi configurada');
    const session = ok[0]?.json<LocalSessionResponse>();
    expect(session).toMatchObject({ mustChangePassword: false });
    adminToken = session?.token ?? '';
    expect(adminToken).toMatch(/^olly_s_/);

    const me = (await call('GET', '/me', undefined, adminToken)).json<MeResponse>();
    expect(me).toMatchObject({ authMethod: 'local', mustChangePassword: false });
    expect(me.permissions.global).toContain('user:manage');
    const project = await call('POST', '/projects', { name: 'Primeiro projeto' }, adminToken);
    expect(project.statusCode).toBe(201);
    expect(project.json<ProjectSummary>().name).toBe('Primeiro projeto');

    expect((await call('GET', '/auth/config')).json<AuthConfig>().setupRequired).toBe(false);
    const again = await call('POST', '/auth/setup', {
      name: 'Zé',
      email: 'ze@olly.local',
      password: SENHA_ADMIN,
    });
    expect(again.statusCode).toBe(409);
    // FR-013: auditado.
    expect(await audit('auth.setup')).toHaveLength(1);
  });
});

describe('spec 014 — HU-2: login local', () => {
  const adminEmail = async () =>
    (await call('GET', '/me', undefined, adminToken)).json<MeResponse>().email;

  it('FR-004/FR-005: login com e-mail e senha; erro genérico para senha errada e e-mail inexistente', async () => {
    const email = await adminEmail();
    const wrong = await login(email, 'senha-errada-qualquer');
    const missing = await login('ninguem@olly.local', 'senha-errada-qualquer');
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json<{ error: { message: string } }>().error.message).toBe(
      missing.json<{ error: { message: string } }>().error.message,
    );
    const ok = await login(`  ${email.toUpperCase()} `, SENHA_ADMIN);
    expect(ok.statusCode).toBe(200);
    const token = ok.json<LocalSessionResponse>().token;
    expect((await call('GET', '/me', undefined, token)).statusCode).toBe(200);
    expect((await audit('auth.local_login')).length).toBeGreaterThanOrEqual(1);
    expect((await audit('auth.local_login_failed')).length).toBeGreaterThanOrEqual(2);
  });

  it('FR-005/NFR-004: 5 tentativas erradas bloqueiam, mesmo com a senha certa depois; o bloqueio expira', async () => {
    const email = await adminEmail();
    for (let i = 0; i < 5; i++)
      expect((await login(email, `errada-${String(i)}-xxxxxx`)).statusCode).toBe(401);
    const blocked = await login(email, SENHA_ADMIN);
    expect(blocked.statusCode).toBe(401);
    expect(await audit('auth.local_locked')).toHaveLength(1);
    // Passado o prazo, a senha certa volta a entrar e as tentativas são zeradas.
    await ctx.database.db
      .updateTable('users')
      .set({ locked_until: new Date(Date.now() - 1000) })
      .where('email', '=', email)
      .execute();
    expect((await login(email, SENHA_ADMIN)).statusCode).toBe(200);
    const row = await ctx.database.db
      .selectFrom('users')
      .select(['failed_logins', 'locked_until'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ failed_logins: 0, locked_until: null });
  });

  it('FR-004/NFR-004: sessão expira por inatividade e por tempo máximo; sair encerra', async () => {
    const email = await adminEmail();
    const session = async () =>
      (await login(email, SENHA_ADMIN)).json<LocalSessionResponse>().token;
    const byToken = (token: string) => createHash('sha256').update(token).digest('hex');
    const idle = await session();
    await ctx.database.db
      .updateTable('user_sessions')
      .set({ last_used_at: new Date(Date.now() - 9 * 3_600_000) })
      .where('token_hash', '=', byToken(idle))
      .execute();
    expect((await call('GET', '/me', undefined, idle)).statusCode).toBe(401);

    const expired = await session();
    await ctx.database.db
      .updateTable('user_sessions')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('token_hash', '=', byToken(expired))
      .execute();
    expect((await call('GET', '/me', undefined, expired)).statusCode).toBe(401);

    const open = await session();
    expect((await call('GET', '/me', undefined, open)).statusCode).toBe(200);
    expect((await call('POST', '/auth/logout', undefined, open)).statusCode).toBe(204);
    expect((await call('GET', '/me', undefined, open)).statusCode).toBe(401);
  });

  it('FR-007: trocar a própria senha exige a atual e encerra as outras sessões', async () => {
    const email = await adminEmail();
    const other = (await login(email, SENHA_ADMIN)).json<LocalSessionResponse>().token;
    expect((await call('GET', '/me', undefined, other)).statusCode).toBe(200);
    const wrong = await call(
      'PUT',
      '/auth/password',
      { currentPassword: 'nao-e-a-senha-atual', newPassword: SENHA_NOVA },
      adminToken,
    );
    expect(wrong.statusCode).toBe(422);
    const weak = await call(
      'PUT',
      '/auth/password',
      { currentPassword: SENHA_ADMIN, newPassword: 'password1234' },
      adminToken,
    );
    expect(weak.statusCode).toBe(422);
    const changed = await call(
      'PUT',
      '/auth/password',
      { currentPassword: SENHA_ADMIN, newPassword: SENHA_NOVA },
      adminToken,
    );
    expect(changed.statusCode).toBe(204);
    // A sessão atual continua; as outras são encerradas.
    expect((await call('GET', '/me', undefined, adminToken)).statusCode).toBe(200);
    expect((await call('GET', '/me', undefined, other)).statusCode).toBe(401);
    expect((await login(email, SENHA_ADMIN)).statusCode).toBe(401);
    expect((await login(email, SENHA_NOVA)).statusCode).toBe(200);
    expect(await audit('auth.password_change')).toHaveLength(1);
  });

  it('SC-005/NFR-002: nenhuma senha em logs, respostas, auditoria ou banco em texto claro', async () => {
    const dump = await ctx.database.db.selectFrom('users').select('password_hash').execute();
    const auditRows = await ctx.database.db.selectFrom('audit_log').selectAll().execute();
    const everything = [
      ...logs,
      ...responses,
      JSON.stringify(auditRows),
      JSON.stringify(dump),
    ].join('\n');
    for (const secret of [SENHA_ADMIN, SENHA_NOVA]) expect(everything).not.toContain(secret);
    expect(
      dump.every((r) => r.password_hash === null || r.password_hash.startsWith('scrypt$')),
    ).toBe(true);
  });
});
