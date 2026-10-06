import type {
  AiPricing,
  AiUsageRow,
  ExecutionAiUsage,
  ExecutionList,
  ProjectAiUsage,
  ProjectSummary,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentWorkflow, allowModels, fakeModelCredential } from '../testing/ai.js';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let admin: TestUser, editor: TestUser;
let project: ProjectSummary;

beforeAll(async () => {
  ctx = await startTestContext({});
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@usage.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@usage.local' });
  project = (await admin.call('POST', '/projects', { name: 'Custos' })).json<ProjectSummary>();
  await allowModels(admin, ['fake-model', 'fake-model-2']);
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
});
afterAll(async () => {
  await ctx.close();
});

/** Uma chamada ao modelo com 1.000 tokens de entrada e 500 de saída. */
async function runOnce(model = 'fake-model', name?: string) {
  const credentialId = await fakeModelCredential(editor, project.id, [
    { content: 'ok', usage: { input: 1000, output: 500 } },
  ]);
  const wf = await createWorkflow(
    editor,
    project.id,
    agentWorkflow({ credentialId, model, pinData: { m: [{ json: { pergunta: 'quanto?' } }] } }),
    name,
  );
  const executionId = await startTestRun(editor, wf);
  return { wf, executionId, detail: await waitForStatus(editor, executionId) };
}

describe('spec 011 — SC-009/FR-014/FR-015: uso e custo de LLM', () => {
  it('FR-014: a tabela de preços é semeada e editável pela administração (auditado)', async () => {
    const seeded = (await admin.call('GET', '/ai-pricing')).json<AiPricing[]>();
    expect(seeded.map((p) => p.model)).toEqual(
      expect.arrayContaining(['gpt-4o-mini', 'claude-sonnet-5-5', 'gemini-2.5-flash']),
    );
    expect((await editor.call('GET', '/ai-pricing')).statusCode).toBe(403);
    const res = await admin.call('PUT', '/ai-pricing/fake-model', {
      provider: 'fake',
      inputPer1m: 2,
      outputPer1m: 10,
      note: 'preço de teste',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<AiPricing[]>().find((p) => p.model === 'fake-model')).toMatchObject({
      inputPer1m: 2,
      outputPer1m: 10,
      currency: 'USD',
    });
    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', 'fake-model')
      .where('entity_type', '=', 'llm_pricing')
      .executeTakeFirst();
    expect(audit?.action).toBe('ai.pricing_update');
  });

  it('SC-009: tokens e custo estimado por execução, workflow e projeto', async () => {
    const { wf, executionId, detail } = await runOnce('fake-model', 'Custo do agente');
    expect(detail.status).toBe('success');
    // (1000 × 2 + 500 × 10) / 1.000.000 = 0,007 USD
    const usage = (
      await editor.call('GET', `/executions/${executionId}/ai-usage`)
    ).json<ExecutionAiUsage>();
    expect(usage).toMatchObject({
      inputTokens: 1000,
      outputTokens: 500,
      calls: 1,
      cost: 0.007,
      currency: 'USD',
    });
    expect(usage.byModel).toEqual([
      expect.objectContaining({ model: 'fake-model', provider: 'fake' }),
    ]);

    // Modelo sem preço cadastrado: tokens contam, custo fica desconhecido.
    const unpriced = await runOnce('fake-model-2');
    expect(
      (
        await editor.call('GET', `/executions/${unpriced.executionId}/ai-usage`)
      ).json<ExecutionAiUsage>().cost,
    ).toBeNull();

    const projectUsage = (
      await admin.call('GET', `/projects/${project.id}/ai-usage`)
    ).json<ProjectAiUsage>();
    expect(projectUsage.total).toMatchObject({ inputTokens: 2000, outputTokens: 1000, calls: 2 });
    expect(projectUsage.monthTokens).toBe(3000);
    expect(projectUsage.byWorkflow.find((w) => w.id === wf.id)).toMatchObject({
      name: 'Custo do agente',
      cost: 0.007,
    });
    expect((await editor.call('GET', `/projects/${project.id}/ai-usage`)).statusCode).toBe(403);

    const global = (await admin.call('GET', '/ai-usage')).json<AiUsageRow[]>();
    expect(global.find((p) => p.id === project.id)).toMatchObject({ calls: 2 });
  });

  it('FR-015: atingido o limite mensal de tokens do projeto, novas chamadas são bloqueadas', async () => {
    const res = await admin.call('PUT', `/projects/${project.id}/ai-settings`, {
      allowedModels: null,
      monthlyTokenLimit: 3000,
    });
    expect(res.statusCode).toBe(200);
    // O editor só lê a configuração.
    expect(
      (
        await editor.call('PUT', `/projects/${project.id}/ai-settings`, {
          allowedModels: null,
          monthlyTokenLimit: null,
        })
      ).statusCode,
    ).toBe(403);
    expect((await editor.call('GET', `/projects/${project.id}/ai-settings`)).json()).toMatchObject({
      monthlyTokenLimit: 3000,
    });

    const blocked = await runOnce();
    expect(blocked.detail.status).toBe('error');
    expect(blocked.detail.error?.message).toContain('Limite mensal de tokens do projeto atingido');
    expect(
      (
        await editor.call('GET', `/executions/${blocked.executionId}/ai-usage`)
      ).json<ExecutionAiUsage>().calls,
    ).toBe(0);

    await admin.call('PUT', `/projects/${project.id}/ai-settings`, {
      allowedModels: null,
      monthlyTokenLimit: null,
    });
    expect((await runOnce()).detail.status).toBe('success');
    const list = (
      await editor.call('GET', `/executions?projectId=${project.id}`)
    ).json<ExecutionList>();
    expect(list.items.length).toBeGreaterThanOrEqual(4);
  });
});
