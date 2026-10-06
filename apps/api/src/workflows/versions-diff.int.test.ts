import type {
  ProjectSummary,
  PublishResponse,
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowDiff,
  WorkflowVersionDetail,
  WorkflowVersionSummary,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let editor: TestUser, viewer: TestUser;
let project: ProjectSummary;

const v1: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 's',
      type: 'data.set',
      name: 'Dados',
      params: { fields: [{ name: 'a', type: 'number', value: '1' }] },
      position: [200, 0],
    },
    { id: 'old', type: 'data.set', name: 'Antigo', params: { fields: [] }, position: [400, 0] },
  ],
  edges: [
    { id: 'e1', from: 'm', fromPort: 'main', to: 's', toPort: 'main' },
    { id: 'e2', from: 's', fromPort: 'main', to: 'old', toPort: 'main' },
  ],
  settings: {},
};

const v2: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 's',
      type: 'data.set',
      name: 'Dados renomeado',
      params: { fields: [{ name: 'a', type: 'number', value: '2' }] },
      position: [220, 40],
      settings: { onError: 'continue' },
    },
    { id: 'new', type: 'data.set', name: 'Novo', params: { fields: [] }, position: [400, 0] },
  ],
  edges: [
    { id: 'e1', from: 'm', fromPort: 'main', to: 's', toPort: 'main' },
    { id: 'e3', from: 's', fromPort: 'main', to: 'new', toPort: 'main' },
  ],
  settings: { timeoutSec: 60 },
};

beforeAll(async () => {
  ctx = await startTestContext({}, { worker: false });
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local', name: 'Edna' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'Versões' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  await admin.call('PUT', `/projects/${project.id}/members/${viewer.id}`, { role: 'viewer' });
});
afterAll(async () => {
  await ctx.close();
});

describe('spec 009 — FR-008/FR-009/SC-005: histórico, diff e restauração', () => {
  let wf: WorkflowDetail;

  it('FR-009: mensagem opcional ao salvar; FR-008: lista versões com autor, data e mensagem', async () => {
    wf = (
      await editor.call('POST', `/projects/${project.id}/workflows`, {
        name: 'Hist',
        definition: v1,
      })
    ).json<WorkflowDetail>();
    const saved = await editor.call('PUT', `/workflows/${wf.id}`, {
      definition: v2,
      baseVersion: 1,
      message: 'Troca o valor e adiciona o nó Novo',
    });
    expect(saved.statusCode).toBe(200);
    const versions = (await viewer.call('GET', `/workflows/${wf.id}/versions`)).json<
      WorkflowVersionSummary[]
    >();
    expect(versions.map((v) => [v.version, v.message, v.createdByName])).toEqual([
      [2, 'Troca o valor e adiciona o nó Novo', 'Edna'],
      [1, null, 'Edna'],
    ]);
    const one = (
      await viewer.call('GET', `/workflows/${wf.id}/versions/1`)
    ).json<WorkflowVersionDetail>();
    expect(one.definition.nodes.map((n) => n.id)).toEqual(['m', 's', 'old']);
    expect((await viewer.call('GET', `/workflows/${wf.id}/versions/99`)).statusCode).toBe(404);
  });

  it('FR-008/SC-005: diff com nós e arestas adicionados, removidos e alterados (patch dos parâmetros)', async () => {
    const diff = (
      await viewer.call('GET', `/workflows/${wf.id}/diff?from=1&to=2`)
    ).json<WorkflowDiff>();
    expect(diff.nodes.added.map((n) => n.id)).toEqual(['new']);
    expect(diff.nodes.removed.map((n) => n.id)).toEqual(['old']);
    expect(diff.nodes.changed).toHaveLength(1);
    const change = diff.nodes.changed[0];
    expect(change).toMatchObject({
      id: 's',
      name: 'Dados renomeado',
      previousName: 'Dados',
      position: { from: [200, 0], to: [220, 40] },
    });
    expect(change?.params).toEqual([{ op: 'replace', path: '/fields/0/value', value: '2' }]);
    expect(change?.settings).toEqual([{ op: 'add', path: '/onError', value: 'continue' }]);
    expect(diff.edges.added.map((e) => e.id)).toEqual(['e3']);
    expect(diff.edges.removed.map((e) => e.id)).toEqual(['e2']);
    expect(diff.settings).toEqual([{ op: 'add', path: '/timeoutSec', value: 60 }]);
    // `to` padrão: a versão atual.
    expect(
      (await viewer.call('GET', `/workflows/${wf.id}/diff?from=1`)).json<WorkflowDiff>().to,
    ).toBe(2);
  });

  it('FR-008/SC-005: restaurar cria uma nova versão com a definição antiga; o histórico fica', async () => {
    expect((await viewer.call('POST', `/workflows/${wf.id}/versions/1/restore`)).statusCode).toBe(
      403,
    );
    const res = await editor.call('POST', `/workflows/${wf.id}/versions/1/restore`, {});
    expect(res.statusCode).toBe(200);
    const restored = res.json<WorkflowDetail>();
    expect(restored.version).toBe(3);
    expect(restored.definition).toEqual(v1);
    const versions = (await editor.call('GET', `/workflows/${wf.id}/versions`)).json<
      WorkflowVersionSummary[]
    >();
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0]?.message).toBe('Restaurada da versão 1');
    const diff = (
      await editor.call('GET', `/workflows/${wf.id}/diff?from=1&to=3`)
    ).json<WorkflowDiff>();
    expect(diff.nodes.added).toEqual([]);
    expect(diff.nodes.removed).toEqual([]);
    expect(diff.nodes.changed).toEqual([]);
    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select('details')
      .where('action', '=', 'workflow.restore')
      .where('entity_id', '=', wf.id)
      .executeTakeFirstOrThrow();
    expect(audit.details).toEqual({ from: 1, version: 3 });
  });

  it('FR-009: a mensagem é obrigatória ao publicar e vira a mensagem da versão', async () => {
    const noMessage = await editor.call('POST', `/workflows/${wf.id}/publish`, {});
    expect(noMessage.statusCode).toBe(400);
    expect(noMessage.body).toContain('message');
    const blank = await editor.call('POST', `/workflows/${wf.id}/publish`, { message: '   ' });
    expect(blank.statusCode).toBe(400);
    const published = await editor.call('POST', `/workflows/${wf.id}/publish`, {
      version: 1,
      message: 'Primeira publicação',
    });
    expect(published.statusCode).toBe(200);
    expect(published.json<PublishResponse>().publishedVersion).toBe(1);
    const versions = (await editor.call('GET', `/workflows/${wf.id}/versions`)).json<
      WorkflowVersionSummary[]
    >();
    expect(versions.find((v) => v.version === 1)?.message).toBe('Primeira publicação');
    // Versão que já tinha mensagem a mantém; a da publicação fica na auditoria.
    await editor.call('POST', `/workflows/${wf.id}/publish`, {
      version: 2,
      message: 'Publica a 2',
    });
    const after = (await editor.call('GET', `/workflows/${wf.id}/versions`)).json<
      WorkflowVersionSummary[]
    >();
    expect(after.find((v) => v.version === 2)?.message).toBe('Troca o valor e adiciona o nó Novo');
    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select('details')
      .where('action', '=', 'workflow.publish')
      .where('entity_id', '=', wf.id)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(audit.details).toMatchObject({ version: 2, message: 'Publica a 2' });
  });
});
