import type { MeResponse, ProjectSummary, WorkflowDetail } from '@olly/shared-types';
import { DEFAULT_ROLE_PERMISSIONS } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let admin: TestUser, editor: TestUser, executor: TestUser, viewer: TestUser, outsider: TestUser;
let projectId: string, otherProjectId: string, workflow: WorkflowDetail;

const manualSet = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    { id: 's', type: 'data.set', name: 'Definir', params: { fields: [] }, position: [200, 0] },
  ],
  edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 's', toPort: 'main' }],
  settings: {},
};

beforeAll(async () => {
  ctx = await startTestContext();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  // O grupo do IdP não concede mais nada fora do projeto (spec 002).
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local', groups: ['editor'] });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@t.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@t.local' });
  outsider = await loginAs(ctx, { sub: 'outsider', email: 'outsider@t.local' });

  projectId = (await admin.call('POST', '/projects', { name: 'Financeiro' })).json<ProjectSummary>()
    .id;
  otherProjectId = (await admin.call('POST', '/projects', { name: 'RH' })).json<ProjectSummary>()
    .id;
  for (const [user, role] of [
    [editor, 'editor'],
    [executor, 'executor'],
    [viewer, 'viewer'],
  ] as const) {
    expect(
      (await admin.call('PUT', `/projects/${projectId}/members/${user.id}`, { role })).statusCode,
    ).toBe(200);
  }
  await admin.call('PUT', `/projects/${otherProjectId}/members/${outsider.id}`, { role: 'editor' });
  workflow = (
    await editor.call('POST', `/projects/${projectId}/workflows`, {
      name: 'Fluxo',
      definition: manualSet,
    })
  ).json<WorkflowDetail>();
});
afterAll(async () => {
  await ctx.close();
});

describe('spec 002 — FR-010: permissões por projeto', () => {
  it('FR-010: /me traz as permissões do papel em cada projeto', async () => {
    const me = (await editor.call('GET', '/me')).json<MeResponse>();
    expect(me.permissions).toEqual({
      global: [],
      projects: { [projectId]: [...DEFAULT_ROLE_PERMISSIONS.editor].sort() },
    });
  });

  it('FR-010: administrador global acessa qualquer projeto sem ser membro', async () => {
    expect((await admin.call('GET', `/workflows/${workflow.id}`)).statusCode).toBe(200);
    const list = (await admin.call('GET', '/projects')).json<ProjectSummary[]>();
    expect(list.map((p) => [p.name, p.role])).toEqual([
      ['Financeiro', null],
      ['RH', null],
    ]);
  });

  it('FR-010: membro vê só os seus projetos, com o seu papel', async () => {
    const list = (await viewer.call('GET', '/projects')).json<ProjectSummary[]>();
    expect(list.map((p) => [p.name, p.role])).toEqual([['Financeiro', 'viewer']]);
  });

  it('FR-010: editor cria e altera workflows do projeto', async () => {
    const res = await editor.call('PUT', `/workflows/${workflow.id}`, {
      definition: manualSet,
      baseVersion: workflow.version,
    });
    expect(res.statusCode).toBe(200);
    workflow = res.json<WorkflowDetail>();
  });

  it.each([
    ['viewer', () => viewer],
    ['executor', () => executor],
  ])('FR-010/SC-002: %s lê, mas não altera (403)', async (_name, user) => {
    expect((await user().call('GET', `/workflows/${workflow.id}`)).statusCode).toBe(200);
    expect((await user().call('GET', `/projects/${projectId}/workflows`)).statusCode).toBe(200);
    const put = await user().call('PUT', `/workflows/${workflow.id}`, {
      definition: manualSet,
      baseVersion: workflow.version,
    });
    expect(put.statusCode).toBe(403);
    expect((await user().call('DELETE', `/workflows/${workflow.id}`)).statusCode).toBe(403);
    expect(
      (await user().call('POST', `/projects/${projectId}/workflows`, { name: 'x' })).statusCode,
    ).toBe(403);
  });

  it('FR-010: só quem tem project:manage gerencia membros e projetos', async () => {
    expect((await editor.call('GET', `/projects/${projectId}/members`)).statusCode).toBe(403);
    expect((await editor.call('PUT', `/projects/${projectId}`, { name: 'Novo' })).statusCode).toBe(
      403,
    );
    expect((await editor.call('POST', '/projects', { name: 'Meu' })).statusCode).toBe(403);
    expect((await editor.call('GET', '/users?search=t')).statusCode).toBe(403);
    expect((await admin.call('GET', '/users?search=viewer')).json<unknown[]>()).toHaveLength(1);
  });

  it('FR-010: papel admin no projeto gerencia aquele projeto, não outros', async () => {
    const lead = await loginAs(ctx, { sub: 'lead', email: 'lead@t.local' });
    await admin.call('PUT', `/projects/${projectId}/members/${lead.id}`, { role: 'admin' });
    expect((await lead.call('GET', `/projects/${projectId}/members`)).statusCode).toBe(200);
    expect((await lead.call('GET', '/users')).statusCode).toBe(200);
    expect((await lead.call('GET', `/projects/${otherProjectId}/members`)).statusCode).toBe(404);
    expect((await lead.call('POST', '/projects', { name: 'Outro' })).statusCode).toBe(403);
  });
});

describe('spec 002 — FR-011/SC-003: recurso de outro projeto responde 404', () => {
  it.each([
    ['GET', () => `/workflows/${workflow.id}`],
    ['PUT', () => `/workflows/${workflow.id}`],
    ['DELETE', () => `/workflows/${workflow.id}`],
    ['GET', () => `/workflows/${workflow.id}/versions`],
    ['GET', () => `/projects/${projectId}`],
    ['GET', () => `/projects/${projectId}/workflows`],
    ['POST', () => `/projects/${projectId}/workflows`],
  ] as const)('FR-011: não membro → 404 em %s %s', async (method, path) => {
    const res = await outsider.call(method, path(), {
      name: 'x',
      definition: manualSet,
      baseVersion: 1,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('FR-011: inexistente e id inválido também → 404', async () => {
    expect(
      (await admin.call('GET', '/workflows/00000000-0000-4000-8000-000000000000')).statusCode,
    ).toBe(404);
    expect((await admin.call('GET', '/workflows/nao-e-uuid')).statusCode).toBe(404);
    expect((await admin.call('GET', '/projects/nao-e-uuid')).statusCode).toBe(404);
  });

  it('FR-011: membro removido perde o acesso (404)', async () => {
    const temp = await loginAs(ctx, { sub: 'temp', email: 'temp@t.local' });
    await admin.call('PUT', `/projects/${projectId}/members/${temp.id}`, { role: 'viewer' });
    expect((await temp.call('GET', `/workflows/${workflow.id}`)).statusCode).toBe(200);
    expect(
      (await admin.call('DELETE', `/projects/${projectId}/members/${temp.id}`)).statusCode,
    ).toBe(204);
    expect((await temp.call('GET', `/workflows/${workflow.id}`)).statusCode).toBe(404);
  });
});

describe('spec 002 — FR-013: projetos e membros', () => {
  it('FR-013: cria, renomeia, lista membros, troca papel e remove', async () => {
    const id = (await admin.call('POST', '/projects', { name: 'Compras' })).json<ProjectSummary>()
      .id;
    expect((await admin.call('PUT', `/projects/${id}`, { name: 'Suprimentos' })).statusCode).toBe(
      204,
    );
    expect((await admin.call('GET', `/projects/${id}`)).json<ProjectSummary>().name).toBe(
      'Suprimentos',
    );
    await admin.call('PUT', `/projects/${id}/members/${viewer.id}`, { role: 'viewer' });
    const changed = await admin.call('PUT', `/projects/${id}/members/${viewer.id}`, {
      role: 'executor',
    });
    expect(changed.json()).toMatchObject({ userId: viewer.id, role: 'executor' });
    expect((await admin.call('GET', `/projects/${id}/members`)).json<unknown[]>()).toHaveLength(1);
    expect((await admin.call('DELETE', `/projects/${id}/members/${viewer.id}`)).statusCode).toBe(
      204,
    );
    expect((await admin.call('DELETE', `/projects/${id}`)).statusCode).toBe(204);
    expect((await admin.call('GET', `/projects/${id}`)).statusCode).toBe(404);
  });

  it('FR-013: valida corpo, papel e usuário', async () => {
    expect((await admin.call('POST', '/projects', { name: '' })).statusCode).toBe(400);
    const bad = await admin.call('PUT', `/projects/${projectId}/members/${viewer.id}`, {
      role: 'dono',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({
      error: { code: 'validation_failed', issues: [{ path: ['role'] }] },
    });
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect(
      (await admin.call('PUT', `/projects/${projectId}/members/${ghost}`, { role: 'viewer' }))
        .statusCode,
    ).toBe(404);
    expect((await admin.call('DELETE', `/projects/${projectId}/members/${ghost}`)).statusCode).toBe(
      404,
    );
  });

  it('FR-013: projeto com workflows não pode ser excluído (409)', async () => {
    expect((await admin.call('DELETE', `/projects/${projectId}`)).statusCode).toBe(409);
  });
});
