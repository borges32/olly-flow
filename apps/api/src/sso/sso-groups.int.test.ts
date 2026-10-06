import type {
  GroupRoleMapping,
  LoginResponse,
  MeResponse,
  ProjectMember,
  ProjectSummary,
  UserAdminSummary,
} from '@olly/shared-types';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { AuditService } from '../audit/audit.service.js';
import { UserSyncService } from '../auth/user-sync.service.js';
import type { AppConfig } from '../config/config.js';
import { REDIS } from '../core/tokens.js';
import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let admin: TestUser;
let x: ProjectSummary;
let y: ProjectSummary;

/** Login institucional: token novo do IdP apresentado em `POST /auth/login`. */
async function idpLogin(
  claims: Record<string, unknown>,
): Promise<{ res: LightMyRequestResponse; token: string }> {
  const token = await ctx.issuer.sign(claims);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { authorization: `Bearer ${token}` },
  });
  return { res, token };
}

const get = (token: string, path: string) =>
  ctx.app.inject({
    method: 'GET',
    url: `/api/v1${path}`,
    headers: { authorization: `Bearer ${token}` },
  });

const membersOf = async (projectId: string) =>
  (await admin.call('GET', `/projects/${projectId}/members`)).json<ProjectMember[]>();

beforeAll(async () => {
  // Claim de grupos configurável (FR-005): aqui `roles`, como em alguns IdPs.
  ctx = await startTestContext(
    { oidc: { adminGroup: 'olly-admins', groupsClaim: 'roles' } as AppConfig['oidc'] },
    { worker: false },
  );
}, 180_000);

afterAll(async () => {
  await ctx.close();
});

describe('spec 009 — FR-004/FR-005/SC-001: login institucional com papéis por grupo', () => {
  beforeAll(async () => {
    admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local' });
    // Com a claim `roles` configurada, `groups` não conta: o administrador vem de `roles`.
    const token = await ctx.issuer.sign({
      sub: 'admin',
      email: 'admin@t.local',
      roles: ['olly-admins'],
    });
    admin = {
      ...admin,
      token,
      call: (method, path, payload) =>
        ctx.app.inject({
          method,
          url: `/api/v1${path}`,
          headers: { authorization: `Bearer ${token}` },
          ...(payload !== undefined && { payload: payload as never }),
        }),
    };
    x = (await admin.call('POST', '/projects', { name: 'X' })).json<ProjectSummary>();
    y = (await admin.call('POST', '/projects', { name: 'Y' })).json<ProjectSummary>();
  });

  it('FR-004: o login aceita token do IdP OIDC e lê os grupos da claim configurada', async () => {
    const { res } = await idpLogin({ sub: 'u0', email: 'u0@t.local', roles: ['olly-admins'] });
    expect(res.statusCode).toBe(200);
    const me = await get(
      (await idpLogin({ sub: 'u0', email: 'u0@t.local', roles: ['olly-admins'] })).token,
      '/me',
    );
    expect(me.json<MeResponse>().permissions.global).toContain('audit:read');
  });

  it('FR-005/SC-001: grupo mapeado para Editor do projeto X → editor em X; sair do grupo remove só o herdado', async () => {
    const created = await admin.call('POST', '/sso/group-mappings', {
      idpGroup: 'grupo-editores-x',
      projectId: x.id,
      role: 'editor',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<GroupRoleMapping>()).toMatchObject({ projectName: 'X', role: 'editor' });
    // Mesmo grupo e escopo repetido: conflito.
    expect(
      (
        await admin.call('POST', '/sso/group-mappings', {
          idpGroup: 'grupo-editores-x',
          projectId: x.id,
          role: 'viewer',
        })
      ).statusCode,
    ).toBe(409);

    const ana = { sub: 'ana', email: 'ana@t.local', name: 'Ana' };
    const first = await idpLogin({ ...ana, roles: ['grupo-editores-x'] });
    expect(first.res.statusCode).toBe(200);
    const login = first.res.json<LoginResponse>();
    expect(login.idpMemberships).toEqual([{ projectId: x.id, role: 'editor' }]);
    const me = (await get(first.token, '/me')).json<MeResponse>();
    expect(me.permissions.projects[x.id]).toContain('workflow:update');
    expect((await membersOf(x.id)).find((m) => m.userId === login.userId)).toMatchObject({
      role: 'editor',
      origin: 'idp',
    });

    // Vínculo manual em Y (ajuste do administrador).
    await admin.call('PUT', `/projects/${y.id}/members/${login.userId}`, { role: 'viewer' });

    // Novo login sem o grupo: perde o papel herdado em X, mantém o manual em Y.
    const again = await idpLogin({ ...ana, roles: [] });
    expect(again.res.json<LoginResponse>().idpMemberships).toEqual([]);
    const after = (await get(again.token, '/me')).json<MeResponse>();
    expect(after.permissions.projects[x.id]).toBeUndefined();
    expect(after.permissions.projects[y.id]).toContain('workflow:read');
    expect((await membersOf(y.id)).find((m) => m.userId === login.userId)?.origin).toBe('manual');

    const sync = await ctx.database.db
      .selectFrom('audit_log')
      .select('details')
      .where('action', '=', 'user.idp_sync')
      .where('entity_id', '=', login.userId)
      .orderBy('id')
      .execute();
    expect(sync).toHaveLength(2);
  });

  it('FR-005: vínculo manual prevalece sobre o grupo; vários grupos → o papel mais forte', async () => {
    await admin.call('POST', '/sso/group-mappings', {
      idpGroup: 'leitores-x',
      projectId: x.id,
      role: 'viewer',
    });
    const bia = { sub: 'bia', email: 'bia@t.local' };
    const login = (
      await idpLogin({ ...bia, roles: ['leitores-x', 'grupo-editores-x'] })
    ).res.json<LoginResponse>();
    expect(login.idpMemberships).toEqual([{ projectId: x.id, role: 'editor' }]);
    // O administrador ajusta à mão: vira manual e a sincronização não mexe mais.
    await admin.call('PUT', `/projects/${x.id}/members/${login.userId}`, { role: 'executor' });
    const again = await idpLogin({ ...bia, roles: [] });
    expect(again.res.json<LoginResponse>().idpMemberships).toEqual([]);
    expect((await get(again.token, '/me')).json<MeResponse>().permissions.projects[x.id]).toContain(
      'workflow:execute',
    );
  });

  it('FR-005: grupo mapeado para papel global vale em todos os projetos enquanto o usuário estiver no grupo', async () => {
    await admin.call('POST', '/sso/group-mappings', {
      idpGroup: 'auditores',
      projectId: null,
      role: 'viewer',
    });
    const caio = { sub: 'caio', email: 'caio@t.local' };
    const { token } = await idpLogin({ ...caio, roles: ['auditores'] });
    const me = (await get(token, '/me')).json<MeResponse>();
    expect(me.permissions.global).toEqual(['execution:read', 'workflow:read']);
    expect((await get(token, `/projects/${y.id}/workflows`)).statusCode).toBe(200);
    expect((await get(token, '/projects')).json<ProjectSummary[]>().map((p) => p.name)).toEqual(
      expect.arrayContaining(['X', 'Y']),
    );
    const out = await idpLogin({ ...caio, roles: [] });
    expect((await get(out.token, `/projects/${y.id}/workflows`)).statusCode).toBe(404);
  });

  it('FR-005: só a administração da plataforma mapeia grupos', async () => {
    const { token } = await idpLogin({
      sub: 'dani',
      email: 'dani@t.local',
      roles: ['grupo-editores-x'],
    });
    expect((await get(token, '/sso/group-mappings')).statusCode).toBe(403);
  });
});

describe('spec 009 — FR-006/FR-007: inativação e auditoria de login', () => {
  it('FR-007: login e falha de login são auditados, sem o token', async () => {
    const ok = await idpLogin({ sub: 'eva', email: 'eva@t.local' });
    const userId = ok.res.json<LoginResponse>().userId;
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { authorization: `Bearer ${await ctx.issuer.signWithForeignKey({ sub: 'eva' })}` },
    });
    expect(bad.statusCode).toBe(401);
    const rows = await ctx.database.db
      .selectFrom('audit_log')
      .select(['action', 'user_id', 'details', 'entity_id'])
      .where('action', 'in', ['auth.login', 'auth.login_failed'])
      .where('entity_id', 'in', [userId, 'eva'])
      .orderBy('id')
      .execute();
    expect(rows.map((r) => r.action)).toEqual(['auth.login', 'auth.login_failed']);
    expect(rows[1]?.entity_id).toBe(userId);
    expect(JSON.stringify(rows)).not.toContain(ok.token);
    const user = await ctx.database.db
      .selectFrom('users')
      .select('last_login_at')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(user.last_login_at).not.toBeNull();
  });

  it('FR-006: sem login há N dias → inativo e sem acesso; a reativação devolve o acesso', async () => {
    const fabio = { sub: 'fabio', email: 'fabio@t.local' };
    const { res, token } = await idpLogin(fabio);
    const userId = res.json<LoginResponse>().userId;
    await ctx.database.db
      .updateTable('users')
      .set({ last_login_at: new Date(Date.now() - 91 * 86_400_000) })
      .where('id', '=', userId)
      .execute();
    // O job roda no worker; aqui, direto.
    const maintenance = new MaintenanceService(
      ctx.database.db,
      ctx.app.get<Redis>(REDIS),
      ctx.config,
      new AuditService(),
      null,
    );
    const report = await maintenance.run();
    expect(report.usersInactivated).toBeGreaterThanOrEqual(1);
    // O cache de usuários da API expira em 30 s; o teste não espera.
    ctx.app.get(UserSyncService).forget(userId);

    // Desativado (no IdP ou por inatividade): perde o acesso, inclusive com token ainda válido.
    const denied = await idpLogin(fabio);
    expect(denied.res.statusCode).toBe(403);
    expect((await get(token, '/me')).statusCode).toBe(403);
    const failed = await ctx.database.db
      .selectFrom('audit_log')
      .select('details')
      .where('action', '=', 'auth.login_failed')
      .where('entity_id', '=', userId)
      .execute();
    expect(JSON.stringify(failed)).toContain('Usuário inativo');

    const users = (await admin.call('GET', '/admin/users')).json<UserAdminSummary[]>();
    expect(users.find((u) => u.id === userId)?.isActive).toBe(false);
    expect(
      (await admin.call('PUT', `/admin/users/${userId}/active`, { active: true })).statusCode,
    ).toBe(204);
    expect((await idpLogin(fabio)).res.statusCode).toBe(200);
  });

  it('FR-006: desativação manual corta o acesso na hora', async () => {
    const gil = { sub: 'gil', email: 'gil@t.local' };
    const { res, token } = await idpLogin(gil);
    expect((await get(token, '/me')).statusCode).toBe(200);
    await admin.call('PUT', `/admin/users/${res.json<LoginResponse>().userId}/active`, {
      active: false,
    });
    expect((await get(token, '/me')).statusCode).toBe(403);
  });
});
