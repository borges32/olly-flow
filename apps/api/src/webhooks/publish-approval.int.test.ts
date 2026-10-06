import type {
  ProjectSettings,
  ProjectSummary,
  PublishApproval,
  PublishResponse,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let admin: TestUser, autor: TestUser, gestor: TestUser, executor: TestUser, outsider: TestUser;
let project: ProjectSummary;

const definition: WorkflowDefinition = {
  nodes: [{ id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] }],
  edges: [],
  settings: {},
};

const newWorkflow = async () =>
  (
    await autor.call('POST', `/projects/${project.id}/workflows`, {
      name: `wf ${Math.random()}`,
      definition,
    })
  ).json<WorkflowDetail>();

const request = async (wf: WorkflowDetail) => {
  const res = await autor.call('POST', `/workflows/${wf.id}/publish`, {
    message: 'Vai para produção',
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<PublishResponse>();
  if (!body.pendingApproval) throw new Error('pedido não criado');
  return body;
};

beforeAll(async () => {
  ctx = await startTestContext({}, { worker: false });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  autor = await loginAs(ctx, { sub: 'autor', email: 'autor@t.local', name: 'Autor' });
  gestor = await loginAs(ctx, { sub: 'gestor', email: 'gestor@t.local', name: 'Gestor' });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@t.local' });
  outsider = await loginAs(ctx, { sub: 'outsider', email: 'outsider@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'Produção' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${autor.id}`, { role: 'editor' });
  await admin.call('PUT', `/projects/${project.id}/members/${gestor.id}`, { role: 'editor' });
  await admin.call('PUT', `/projects/${project.id}/members/${executor.id}`, { role: 'executor' });
});
afterAll(async () => {
  await ctx.close();
});

describe('spec 009 — FR-011/SC-006: aprovação de publicação "quatro olhos"', () => {
  it('FR-011: sem aprovação ativa, publicar publica direto', async () => {
    const wf = await newWorkflow();
    const res = (
      await autor.call('POST', `/workflows/${wf.id}/publish`, { message: 'Direto' })
    ).json<PublishResponse>();
    expect(res).toMatchObject({ publishedVersion: 1, active: true });
    expect(res.pendingApproval).toBeUndefined();
  });

  it('FR-011: só quem administra o projeto liga a aprovação; a mudança é auditada', async () => {
    expect(
      (
        await autor.call('PUT', `/projects/${project.id}/settings`, {
          requirePublishApproval: true,
        })
      ).statusCode,
    ).toBe(403);
    const res = await admin.call('PUT', `/projects/${project.id}/settings`, {
      requirePublishApproval: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ProjectSettings>().requirePublishApproval).toBe(true);
    // Todos os membros veem a configuração (o editor avisa que a publicação exige aprovação).
    expect(
      (await executor.call('GET', `/projects/${project.id}/settings`)).json<ProjectSettings>()
        .requirePublishApproval,
    ).toBe(true);
  });

  it('FR-011/SC-006: publicar abre um pedido; o autor não aprova nem rejeita; outro usuário aprova e publica', async () => {
    const wf = await newWorkflow();
    const { pendingApproval, publishedVersion, active } = await request(wf);
    expect(publishedVersion).toBeNull();
    expect(active).toBe(false);
    expect(pendingApproval).toMatchObject({
      status: 'pending',
      version: 1,
      message: 'Vai para produção',
      requestedBy: { id: autor.id, name: 'Autor' },
    });
    const id = pendingApproval?.id as string;

    // Segundo pedido para o mesmo workflow enquanto o primeiro está pendente: conflito.
    expect(
      (await autor.call('POST', `/workflows/${wf.id}/publish`, { message: 'De novo' })).statusCode,
    ).toBe(409);

    // SC-006: o autor não aprova o próprio pedido (nem o rejeita).
    const self = await autor.call('POST', `/publish-requests/${id}/approve`, {});
    expect(self.statusCode).toBe(403);
    expect(self.body).toContain('autor');
    expect((await autor.call('POST', `/publish-requests/${id}/reject`, {})).statusCode).toBe(403);
    // Sem workflow:publish no projeto, nem não membro.
    expect((await executor.call('POST', `/publish-requests/${id}/approve`, {})).statusCode).toBe(
      403,
    );
    expect((await outsider.call('POST', `/publish-requests/${id}/approve`, {})).statusCode).toBe(
      404,
    );

    // Pendentes visíveis ao gestor (contador do menu) e ao autor (acompanhamento).
    const pending = (await gestor.call('GET', '/publish-requests?status=pending')).json<
      PublishApproval[]
    >();
    expect(pending.map((p) => p.id)).toContain(id);
    expect(
      (await autor.call('GET', `/publish-requests?workflowId=${wf.id}`)).json<PublishApproval[]>(),
    ).toHaveLength(1);
    expect((await outsider.call('GET', '/publish-requests')).json<PublishApproval[]>()).toEqual([]);

    const approved = await gestor.call('POST', `/publish-requests/${id}/approve`, {
      comment: 'Revisado',
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json<PublishApproval>()).toMatchObject({
      status: 'approved',
      decidedBy: { id: gestor.id },
      comment: 'Revisado',
    });
    const detail = (await autor.call('GET', `/workflows/${wf.id}`)).json<WorkflowDetail>();
    expect(detail).toMatchObject({ publishedVersion: 1, active: true });
    // Decidido não se decide de novo.
    expect((await admin.call('POST', `/publish-requests/${id}/reject`, {})).statusCode).toBe(409);

    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select(['action', 'user_id'])
      .where('entity_id', '=', wf.id)
      .where('action', 'like', 'workflow.publish%')
      .orderBy('id')
      .execute();
    expect(audit.map((a) => a.action)).toEqual([
      'workflow.publish_request',
      'workflow.publish',
      'workflow.publish_request.approve',
    ]);
    // A publicação é registrada em nome de quem aprovou.
    expect(audit[1]?.user_id).toBe(gestor.id);
  });

  it('FR-011: rejeição com comentário; o autor pode cancelar o próprio pedido', async () => {
    const wf = await newWorkflow();
    const id = (await request(wf)).pendingApproval?.id as string;
    const rejected = await gestor.call('POST', `/publish-requests/${id}/reject`, {
      comment: 'Falta tratar o erro',
    });
    expect(rejected.json<PublishApproval>()).toMatchObject({
      status: 'rejected',
      comment: 'Falta tratar o erro',
    });
    expect((await autor.call('GET', `/workflows/${wf.id}`)).json<WorkflowDetail>().active).toBe(
      false,
    );

    const second = (await request(wf)).pendingApproval?.id as string;
    expect((await gestor.call('POST', `/publish-requests/${second}/cancel`, {})).statusCode).toBe(
      403,
    );
    const cancelled = await autor.call('POST', `/publish-requests/${second}/cancel`, {});
    expect(cancelled.json<PublishApproval>().status).toBe('cancelled');
  });

  it('SC-006: o banco também impede autor = aprovador (defesa em profundidade)', async () => {
    const wf = await newWorkflow();
    const id = (await request(wf)).pendingApproval?.id as string;
    await expect(
      ctx.database.db
        .updateTable('publish_requests')
        .set({ status: 'approved', decided_by: autor.id })
        .where('id', '=', id)
        .execute(),
    ).rejects.toThrow(/check/i);
  });
});
