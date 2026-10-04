import type { ProjectSummary, WorkflowDetail } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let admin: TestUser;
let editor: TestUser;

beforeAll(async () => {
  ctx = await startTestContext();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
});
afterAll(async () => {
  await ctx.close();
});

async function auditFor(entityId: string) {
  return ctx.database.db
    .selectFrom('audit_log')
    .select(['user_id', 'action', 'entity_type', 'details', 'ip'])
    .where('entity_id', '=', entityId)
    .orderBy('id')
    .execute();
}

describe('spec 002 — FR-014: auditoria de projetos, membros e workflows', () => {
  it('FR-014: registra cada mudança com autor, ação, entidade, detalhes e IP', async () => {
    const project = (
      await admin.call('POST', '/projects', { name: 'Auditado' })
    ).json<ProjectSummary>();
    await admin.call('PUT', `/projects/${project.id}`, { name: 'Auditado 2' });
    await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'viewer' });
    await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });

    const wf = (
      await editor.call('POST', `/projects/${project.id}/workflows`, { name: 'Fluxo' })
    ).json<WorkflowDetail>();
    await editor.call('PUT', `/workflows/${wf.id}`, { definition: wf.definition, baseVersion: 1 });
    await editor.call('DELETE', `/workflows/${wf.id}`);
    await admin.call('DELETE', `/projects/${project.id}/members/${editor.id}`);

    const projectLog = await auditFor(project.id);
    expect(projectLog.map((r) => [r.action, r.user_id])).toEqual([
      ['project.create', admin.id],
      ['project.update', admin.id],
      ['project.member.set', admin.id],
      ['project.member.set', admin.id],
      ['project.member.remove', admin.id],
    ]);
    expect(projectLog[1]?.details).toEqual({ from: 'Auditado', to: 'Auditado 2' });
    expect(projectLog[3]?.details).toEqual({
      userId: editor.id,
      role: 'editor',
      previousRole: 'viewer',
    });
    expect(projectLog.every((r) => r.entity_type === 'project' && r.ip === '127.0.0.1')).toBe(true);

    const workflowLog = await auditFor(wf.id);
    expect(workflowLog.map((r) => [r.action, r.user_id])).toEqual([
      ['workflow.create', editor.id],
      ['workflow.update', editor.id],
      ['workflow.delete', editor.id],
    ]);
    expect(workflowLog[1]?.details).toMatchObject({ version: 2, name: 'Fluxo' });
  });

  it('FR-014: exclusão de projeto é auditada', async () => {
    const project = (
      await admin.call('POST', '/projects', { name: 'Temporário' })
    ).json<ProjectSummary>();
    await admin.call('DELETE', `/projects/${project.id}`);
    expect((await auditFor(project.id)).map((r) => r.action)).toEqual([
      'project.create',
      'project.delete',
    ]);
  });

  it('FR-014: operação negada ou inválida não gera registro', async () => {
    const before = await ctx.database.db
      .selectFrom('audit_log')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    await editor.call('POST', '/projects', { name: 'Negado' });
    await admin.call('POST', '/projects', { name: '' });
    const after = await ctx.database.db
      .selectFrom('audit_log')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });
});
