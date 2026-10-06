import type { AiModel, ProjectSummary } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentWorkflow, fakeModelCredential } from '../testing/ai.js';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let admin: TestUser, editor: TestUser;
let project: ProjectSummary;

beforeAll(async () => {
  ctx = await startTestContext({});
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@models.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@models.local' });
  project = (await admin.call('POST', '/projects', { name: 'Modelos' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
});
afterAll(async () => {
  await ctx.close();
});

async function runAgent() {
  const credentialId = await fakeModelCredential(editor, project.id, [{ content: 'ok' }]);
  const wf = await createWorkflow(
    editor,
    project.id,
    agentWorkflow({ credentialId, pinData: { m: [{ json: { pergunta: 'oi' } }] } }),
  );
  return waitForStatus(editor, await startTestRun(editor, wf));
}

describe('spec 011 — FR-002: cadastro de modelos permitidos na administração', () => {
  it('FR-002: a lista começa vazia e o Agent fica indisponível', async () => {
    expect((await admin.call('GET', '/ai-models')).json<AiModel[]>()).toEqual([]);
    const detail = await runAgent();
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toContain('Nenhum modelo de IA está permitido');
    expect(detail.error?.message).toContain('Administração › IA');
  });

  it('FR-002: incluir e remover um modelo vale na hora, sem reiniciar (auditado)', async () => {
    const added = await admin.call('PUT', '/ai-models/fake-model', { note: 'Modelo de teste' });
    expect(added.statusCode).toBe(200);
    expect(added.json<AiModel[]>()).toEqual([
      expect.objectContaining({
        model: 'fake-model',
        note: 'Modelo de teste',
        createdBy: admin.id,
      }),
    ]);
    // A lista do nó Modelo de chat e a execução já enxergam o modelo.
    expect((await editor.call('GET', `/projects/${project.id}/ai-models`)).json()).toEqual([
      'fake-model',
    ]);
    expect((await runAgent()).status).toBe('success');

    expect((await admin.call('DELETE', '/ai-models/fake-model')).statusCode).toBe(204);
    expect((await admin.call('DELETE', '/ai-models/fake-model')).statusCode).toBe(404);
    expect((await runAgent()).error?.message).toContain('Nenhum modelo de IA está permitido');

    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', 'fake-model')
      .orderBy('id')
      .execute();
    expect(audit.map((a) => a.action)).toEqual(['ai.model_allow', 'ai.model_remove']);
  });

  it('FR-002: só a administração da plataforma cadastra; o projeto só restringe dentro da lista', async () => {
    expect((await editor.call('GET', '/ai-models')).statusCode).toBe(403);
    expect((await editor.call('PUT', '/ai-models/outro', {})).statusCode).toBe(403);
    expect((await admin.call('PUT', '/ai-models/%20', {})).statusCode).toBe(400);

    await admin.call('PUT', '/ai-models/fake-model', {});
    await admin.call('PUT', '/ai-models/fake-model-2', {});
    const outside = await admin.call('PUT', `/projects/${project.id}/ai-settings`, {
      allowedModels: ['gpt-4o'],
      monthlyTokenLimit: null,
    });
    expect(outside.statusCode).toBe(422);
    expect(outside.body).toContain('gpt-4o');
    const settings = await admin.call('PUT', `/projects/${project.id}/ai-settings`, {
      allowedModels: ['fake-model-2'],
      monthlyTokenLimit: null,
    });
    expect(settings.json()).toMatchObject({
      allowedModels: ['fake-model-2'],
      installationModels: ['fake-model', 'fake-model-2'],
    });
    // Restrito pelo projeto: o modelo da instalação fora da lista do projeto é recusado.
    expect((await runAgent()).error?.message).toContain('"fake-model" não está na lista permitida');
  });
});
