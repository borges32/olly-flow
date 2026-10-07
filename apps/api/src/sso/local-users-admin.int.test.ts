import type {
  LocalSessionResponse,
  ProjectSummary,
  UserAdminSummary,
  WorkflowDetail,
} from '@olly/shared-types';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestContext, type TestContext } from '../testing/test-app.js';

let ctx: TestContext;
let admin = '';
let adminId = '';

async function call(
  method: InjectOptions['method'],
  path: string,
  payload?: unknown,
  token?: string,
) {
  return ctx.app.inject({
    method,
    url: `/api/v1${path}`,
    ...(token && { headers: { authorization: `Bearer ${token}` } }),
    ...(payload !== undefined && { payload: payload as InjectOptions['payload'] }),
  });
}

const login = async (email: string, password: string) =>
  call('POST', '/auth/local/login', { email, password });

const users = async () =>
  (await call('GET', '/admin/users', undefined, admin)).json<UserAdminSummary[]>();

const actions = async (entityId: string) =>
  (
    await ctx.database.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', entityId)
      .orderBy('id')
      .execute()
  ).map((r) => r.action);

beforeAll(async () => {
  ctx = await startTestContext({
    auth: {
      idpEnabled: false,
      sessionIdleMs: 8 * 3_600_000,
      sessionMaxMs: 24 * 3_600_000,
      loginMaxAttempts: 5,
      loginLockMs: 15 * 60_000,
    },
  });
  const setup = await call('POST', '/auth/setup', {
    name: 'Administradora',
    email: 'admin@olly.local',
    password: 'chave-local-segura-1',
  });
  admin = setup.json<LocalSessionResponse>().token;
  adminId = (await users())[0]?.id ?? '';
});
afterAll(async () => {
  await ctx.close();
});

describe('spec 014 — HU-3: administração de usuários locais', () => {
  let userId = '';

  it('FR-006/FR-007/FR-012/SC-003: usuário criado pela administração troca a senha no primeiro acesso e trabalha no projeto', async () => {
    const created = await call(
      'POST',
      '/admin/users',
      { name: 'Bruno', email: 'Bruno@Olly.local', password: 'senha-inicial-colega' },
      admin,
    );
    expect(created.statusCode).toBe(201);
    const summary = created.json<UserAdminSummary>();
    userId = summary.id;
    expect(summary).toMatchObject({
      email: 'bruno@olly.local',
      origin: 'local',
      isAdmin: false,
      mustChangePassword: true,
      isActive: true,
    });
    // E-mail repetido e senha fora da política.
    expect(
      (
        await call(
          'POST',
          '/admin/users',
          { name: 'B2', email: 'bruno@olly.local', password: 'outra-senha-boa-1' },
          admin,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(
          'POST',
          '/admin/users',
          { name: 'C', email: 'c@olly.local', password: 'curta' },
          admin,
        )
      ).statusCode,
    ).toBe(422);

    const first = (
      await login('bruno@olly.local', 'senha-inicial-colega')
    ).json<LocalSessionResponse>();
    expect(first.mustChangePassword).toBe(true);
    // Antes de trocar a senha, só o necessário para trocá-la.
    const blocked = await call('GET', '/projects', undefined, first.token);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.body).toContain('password_change_required');
    expect((await call('GET', '/me', undefined, first.token)).statusCode).toBe(200);
    expect(
      (
        await call(
          'PUT',
          '/auth/password',
          { currentPassword: 'senha-inicial-colega', newPassword: 'nova-senha-do-colega' },
          first.token,
        )
      ).statusCode,
    ).toBe(204);

    // FR-012: o RBAC vale igual para o usuário local.
    const project = (
      await call('POST', '/projects', { name: 'Equipe' }, admin)
    ).json<ProjectSummary>();
    expect(
      (await call('PUT', `/projects/${project.id}/members/${userId}`, { role: 'editor' }, admin))
        .statusCode,
    ).toBe(200);
    const wf = await call(
      'POST',
      `/projects/${project.id}/workflows`,
      { name: 'Do Bruno' },
      first.token,
    );
    expect(wf.statusCode).toBe(201);
    expect(wf.json<WorkflowDetail>().name).toBe('Do Bruno');
    // Usuário comum não administra usuários.
    expect((await call('GET', '/admin/users', undefined, first.token)).statusCode).toBe(403);
    expect(
      (
        await call(
          'POST',
          '/admin/users',
          { name: 'X', email: 'x@olly.local', password: 'senha-boa-do-x-1' },
          first.token,
        )
      ).statusCode,
    ).toBe(403);
  });

  it('FR-006/FR-014: editar nome e e-mail; a listagem mostra origem, situação e último acesso', async () => {
    const res = await call('PATCH', `/admin/users/${userId}`, { name: 'Bruno Lima' }, admin);
    expect(res.statusCode).toBe(200);
    expect(res.json<UserAdminSummary>().name).toBe('Bruno Lima');
    expect(
      (await call('PATCH', `/admin/users/${userId}`, { email: 'admin@olly.local' }, admin))
        .statusCode,
    ).toBe(409);
    const bruno = (await users()).find((u) => u.id === userId);
    expect(bruno).toMatchObject({ origin: 'local', locked: false, mustChangePassword: false });
    expect(bruno?.lastLoginAt).not.toBeNull();
  });

  it('FR-006/FR-007: redefinir a senha encerra as sessões, desbloqueia e exige troca', async () => {
    const open = (
      await login('bruno@olly.local', 'nova-senha-do-colega')
    ).json<LocalSessionResponse>();
    for (let i = 0; i < 5; i++) await login('bruno@olly.local', `errada-${String(i)}-zzzzzz`);
    expect((await users()).find((u) => u.id === userId)?.locked).toBe(true);
    expect(
      (
        await call(
          'PUT',
          `/admin/users/${userId}/password`,
          { password: 'temporaria-do-colega' },
          admin,
        )
      ).statusCode,
    ).toBe(204);
    expect((await call('GET', '/me', undefined, open.token)).statusCode).toBe(401);
    const again = (
      await login('bruno@olly.local', 'temporaria-do-colega')
    ).json<LocalSessionResponse>();
    expect(again.mustChangePassword).toBe(true);
    await call(
      'PUT',
      '/auth/password',
      { currentPassword: 'temporaria-do-colega', newPassword: 'definitiva-do-colega' },
      again.token,
    );
  });

  it('FR-008/SC-004: desativado perde o acesso na hora, mesmo com sessão aberta; o histórico fica', async () => {
    const open = (
      await login('bruno@olly.local', 'definitiva-do-colega')
    ).json<LocalSessionResponse>();
    expect((await call('GET', '/me', undefined, open.token)).statusCode).toBe(200);
    expect(
      (await call('PUT', `/admin/users/${userId}/active`, { active: false }, admin)).statusCode,
    ).toBe(204);
    expect((await call('GET', '/me', undefined, open.token)).statusCode).toBe(401);
    expect((await login('bruno@olly.local', 'definitiva-do-colega')).statusCode).toBe(401);
    const workflows = await ctx.database.db
      .selectFrom('workflows')
      .select('created_by')
      .where('created_by', '=', userId)
      .execute();
    expect(workflows).toHaveLength(1);
    expect(
      (await call('PUT', `/admin/users/${userId}/active`, { active: true }, admin)).statusCode,
    ).toBe(204);
    expect((await login('bruno@olly.local', 'definitiva-do-colega')).statusCode).toBe(200);
  });

  it('FR-009: a plataforma nunca fica sem administrador ativo', async () => {
    const self = await call('PUT', `/admin/users/${adminId}/active`, { active: false }, admin);
    expect(self.statusCode).toBe(409);
    expect(self.body).toContain('administrador');
    expect(
      (await call('PATCH', `/admin/users/${adminId}`, { isAdmin: false }, admin)).statusCode,
    ).toBe(409);
    // Com outro administrador, a primeira pode deixar de ser.
    expect(
      (await call('PATCH', `/admin/users/${userId}`, { isAdmin: true }, admin)).statusCode,
    ).toBe(200);
    expect(
      (await call('PATCH', `/admin/users/${adminId}`, { isAdmin: false }, admin)).statusCode,
    ).toBe(200);
    const bruno = (
      await login('bruno@olly.local', 'definitiva-do-colega')
    ).json<LocalSessionResponse>();
    expect(
      (await call('PATCH', `/admin/users/${adminId}`, { isAdmin: true }, bruno.token)).statusCode,
    ).toBe(200);
  });

  it('FR-013: tudo auditado, sem senha nos detalhes', async () => {
    const list = await actions(userId);
    expect(list).toEqual(
      expect.arrayContaining([
        'user.create',
        'user.update',
        'auth.password_reset',
        'user.deactivate',
        'user.activate',
        'user.admin_grant',
      ]),
    );
    expect(await actions(adminId)).toEqual(expect.arrayContaining(['user.admin_revoke']));
    const rows = await ctx.database.db.selectFrom('audit_log').select('details').execute();
    const dump = JSON.stringify(rows);
    for (const secret of ['senha-inicial-colega', 'temporaria-do-colega', 'definitiva-do-colega']) {
      expect(dump).not.toContain(secret);
    }
  });
});
