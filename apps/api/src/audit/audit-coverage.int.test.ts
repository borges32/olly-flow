import type {
  CredentialSummary,
  ProjectSummary,
  TestRunResponse,
  WorkflowDetail,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let admin: TestUser, editor: TestUser;

beforeAll(async () => {
  ctx = await startTestContext();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
});
afterAll(async () => {
  await ctx.close();
});

const actionsFor = async (entityId: string) =>
  (
    await ctx.database.db
      .selectFrom('audit_log')
      .select(['action', 'user_id'])
      .where('entity_id', '=', entityId)
      .orderBy('id')
      .execute()
  ).map(
    (r) =>
      `${r.action}:${r.user_id === editor.id ? 'editor' : r.user_id === admin.id ? 'admin' : '?'}`,
  );

describe('spec 005 — FR-016: cobertura da auditoria', () => {
  it('FR-016: workflows, publicação, credenciais, membros e execução manual são auditados', async () => {
    const project = (
      await admin.call('POST', '/projects', { name: 'Auditoria' })
    ).json<ProjectSummary>();
    await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'viewer' });
    await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });

    const wf = (
      await editor.call('POST', `/projects/${project.id}/workflows`, { name: 'Auditado' })
    ).json<WorkflowDetail>();
    const definition = {
      nodes: [{ id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] }],
      edges: [],
      settings: {},
    };
    await editor.call('PUT', `/workflows/${wf.id}`, { definition, baseVersion: 1 });
    await editor.call('POST', `/workflows/${wf.id}/publish`, { message: 'Publicação de teste' });
    await editor.call('POST', `/workflows/${wf.id}/unpublish`);
    const { executionId } = (
      await editor.call('POST', `/workflows/${wf.id}/test-run`, { definition })
    ).json<TestRunResponse>();
    await editor.call('DELETE', `/workflows/${wf.id}`);

    const cred = (
      await editor.call('POST', `/projects/${project.id}/credentials`, {
        name: 'API',
        type: 'httpBearer',
        data: { token: 'x' },
      })
    ).json<CredentialSummary>();
    await editor.call('PUT', `/credentials/${cred.id}`, { name: 'API 2' });
    await editor.call('POST', `/credentials/${cred.id}/test`, { url: 'http://10.0.0.1/' });
    await editor.call('DELETE', `/credentials/${cred.id}`);
    await admin.call('DELETE', `/projects/${project.id}/members/${editor.id}`);

    expect(await actionsFor(wf.id)).toEqual([
      'workflow.create:editor',
      'workflow.update:editor',
      'workflow.publish:editor',
      'workflow.unpublish:editor',
      'workflow.delete:editor',
    ]);
    expect(await actionsFor(executionId)).toEqual(['execution.manual:editor']);
    expect(await actionsFor(cred.id)).toEqual([
      'credential.create:editor',
      'credential.update:editor',
      'credential.test:editor',
      'credential.delete:editor',
    ]);
    expect(await actionsFor(project.id)).toEqual([
      'project.create:admin',
      'project.member.set:admin',
      'project.member.set:admin',
      'project.member.remove:admin',
    ]);
  });
});
