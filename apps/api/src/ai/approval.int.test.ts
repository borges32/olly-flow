import { startMcpTestServer, type McpTestServer } from '@olly/mcp-test-server';
import type {
  AgentApproval,
  AgentStep,
  McpPoliciesRequest,
  ProjectSummary,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { agentWorkflow, allowModels, fakeModelCredential, mcpToolNode } from '../testing/ai.js';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { registerMcpServer } from '../testing/mcp.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';
import { ApprovalsService } from './approvals.service.js';

let ctx: TestContext;
let mcp: McpTestServer;
let admin: TestUser, editor: TestUser, executor: TestUser, viewer: TestUser;
let project: ProjectSummary;
let serverId: string;

beforeAll(async () => {
  mcp = await startMcpTestServer();
  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 },
  });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@approval.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@approval.local' });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@approval.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@approval.local' });
  project = (await admin.call('POST', '/projects', { name: 'Aprovações' })).json<ProjectSummary>();
  await allowModels(admin, ['fake-model', 'fake-model-2']);
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  await admin.call('PUT', `/projects/${project.id}/members/${executor.id}`, { role: 'executor' });
  await admin.call('PUT', `/projects/${project.id}/members/${viewer.id}`, { role: 'viewer' });
  serverId = (
    await registerMcpServer(admin, {
      name: 'Registros MCP',
      transport: 'streamableHttp',
      url: `${mcp.url}/mcp`,
    })
  ).id;
  // FR-010: a tool destrutiva é marcada pela administração (spec 010) e exige aprovação.
  const policies: McpPoliciesRequest = {
    projectId: null,
    policies: [
      { toolName: 'consulta_cliente', allowed: true, destructive: false },
      { toolName: 'apagar_registro', allowed: true, destructive: true },
    ],
  };
  await admin.call('PUT', `/mcp-servers/${serverId}/policies`, policies);
});
afterAll(async () => {
  await ctx.close();
  await mcp.close();
});

/** Agente que pede para apagar o registro `id` e responde com o resultado da ferramenta. */
async function startDeletion(id: string): Promise<string> {
  const credentialId = await fakeModelCredential(editor, project.id, [
    { toolCalls: [{ name: 'apagar_registro', args: { id } }] },
    { content: 'Resultado: {{lastTool}}' },
  ]);
  const wf = await createWorkflow(
    editor,
    project.id,
    agentWorkflow({
      credentialId,
      tools: [mcpToolNode(serverId)],
      pinData: { m: [{ json: { pergunta: `Apague o registro ${id}` } }] },
    }),
  );
  const executionId = await startTestRun(editor, wf);
  await waitForStatus(editor, executionId, (s) => s === 'waiting');
  return executionId;
}

async function pendingOf(executionId: string, user = executor): Promise<AgentApproval> {
  const list = (
    await user.call('GET', `/approvals?status=pending&executionId=${executionId}`)
  ).json<AgentApproval[]>();
  expect(list).toHaveLength(1);
  return list[0] as AgentApproval;
}

const output = async (executionId: string) => {
  const done = await waitForStatus(
    editor,
    executionId,
    (s) => !['queued', 'running', 'waiting'].includes(s),
  );
  return {
    status: done.status,
    text: String(done.nodes.find((n) => n.nodeId === 'agent')?.output?.main?.[0]?.json.output),
  };
};

const deletedIds = () =>
  mcp.calls.filter((c) => c.tool === 'apagar_registro').map((c) => (c.args as { id: string }).id);

describe('spec 011 — SC-003/FR-010/FR-011: aprovação humana', () => {
  it('SC-003: a ação destrutiva pausa a execução e só roda depois de aprovada', async () => {
    const executionId = await startDeletion('7');
    expect(deletedIds()).not.toContain('7');

    const approval = await pendingOf(executionId);
    expect(approval).toMatchObject({
      tool: 'apagar_registro',
      arguments: { id: '7' },
      status: 'pending',
      projectName: 'Aprovações',
      nodeId: 'agent',
    });
    expect(approval.reason).toContain('exige aprovação humana');
    // O leitor do projeto não vê nem decide (FR-011: aprovadores têm `workflow:execute`).
    expect(
      (await viewer.call('GET', `/approvals?executionId=${executionId}`)).json<AgentApproval[]>(),
    ).toEqual([]);
    expect((await viewer.call('POST', `/approvals/${approval.id}/approve`, {})).statusCode).toBe(
      403,
    );

    const decided = await executor.call('POST', `/approvals/${approval.id}/approve`, {
      comment: 'pode apagar',
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json<AgentApproval>()).toMatchObject({
      status: 'approved',
      decidedBy: executor.id,
      comment: 'pode apagar',
    });

    const result = await output(executionId);
    expect(result.status).toBe('success');
    expect(result.text).toContain('Registro 7 apagado');
    expect(deletedIds()).toContain('7');
    // Decidir de novo não muda nada.
    expect((await executor.call('POST', `/approvals/${approval.id}/reject`, {})).statusCode).toBe(
      409,
    );

    const steps = (await editor.call('GET', `/executions/${executionId}/agent-steps`)).json<
      AgentStep[]
    >();
    expect(steps.map((s) => s.kind)).toEqual(['model', 'approval', 'tool', 'model', 'final']);
    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select(['action', 'user_id'])
      .where('entity_id', '=', approval.id)
      .orderBy('id')
      .execute();
    expect(audit).toEqual([
      { action: 'agent.approval_requested', user_id: editor.id },
      { action: 'agent.approval_approved', user_id: executor.id },
    ]);
  });

  it('SC-003: rejeitada, a ação não roda e o agente recebe a rejeição como resultado', async () => {
    const executionId = await startDeletion('8');
    const approval = await pendingOf(executionId);
    expect(
      (await executor.call('POST', `/approvals/${approval.id}/reject`, { comment: 'não' }))
        .statusCode,
    ).toBe(200);
    const result = await output(executionId);
    expect(result.status).toBe('success');
    expect(result.text).toContain('Ação rejeitada pelo usuário: não');
    expect(deletedIds()).not.toContain('8');
  });

  it('SC-004: a aprovação sobrevive à troca de worker e a execução retoma', async () => {
    const executionId = await startDeletion('9');
    expect(ctx.worker?.stats().active).toBe(0);
    await ctx.worker?.close(1000);
    const second = await ctx.startWorker();
    const approval = await pendingOf(executionId);
    await executor.call('POST', `/approvals/${approval.id}/approve`, {});
    const result = await output(executionId);
    expect(result.status).toBe('success');
    expect(result.text).toContain('Registro 9 apagado');
    expect(second.stats().processed).toBeGreaterThanOrEqual(1);
  });

  it('NFR-002: pedido vencido é rejeitado automaticamente e auditado', async () => {
    const executionId = await startDeletion('10');
    const approval = await pendingOf(executionId);
    await ctx.database.db
      .updateTable('approval_requests')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', approval.id)
      .execute();
    expect(await ctx.app.get(ApprovalsService).expireDue()).toBe(1);
    const result = await output(executionId);
    expect(result.text).toContain('Ação rejeitada pelo usuário: Prazo de aprovação expirado');
    expect(deletedIds()).not.toContain('10');
    const row = await ctx.database.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', approval.id)
      .where('action', '=', 'agent.approval_expired')
      .executeTakeFirst();
    expect(row).toBeDefined();
  });

  it('FR-010: a execução só aparece em espera depois de o pedido e o estado serem gravados', async () => {
    // Pedido lento: sem a ordem certa, a tela mostraria "aguardando" sem nada para decidir.
    const original = Reflect.get<ApprovalsService, 'createFromWaiting'>(
      ApprovalsService.prototype,
      'createFromWaiting',
    );
    const spy = vi
      .spyOn(ApprovalsService.prototype, 'createFromWaiting')
      .mockImplementation(async function (this: ApprovalsService, input) {
        await new Promise((r) => setTimeout(r, 1000));
        return original.call(this, input);
      });
    try {
      const executionId = await startDeletion('12');
      const approval = await pendingOf(executionId);
      const state = await ctx.database.db
        .selectFrom('execution_state')
        .select('execution_id')
        .where('execution_id', '=', executionId)
        .executeTakeFirst();
      expect(state).toBeDefined();
      await executor.call('POST', `/approvals/${approval.id}/reject`, {});
      expect((await output(executionId)).status).toBe('success');
    } finally {
      spy.mockRestore();
    }
  });

  it('FR-011: cancelar a execução em espera cancela o pedido', async () => {
    const executionId = await startDeletion('11');
    const approval = await pendingOf(executionId);
    expect((await editor.call('POST', `/executions/${executionId}/cancel`)).statusCode).toBe(202);
    await waitForStatus(editor, executionId, (s) => s === 'cancelled');
    const [after] = (await executor.call('GET', `/approvals?executionId=${executionId}`)).json<
      AgentApproval[]
    >();
    expect(after?.status).toBe('cancelled');
    expect((await executor.call('POST', `/approvals/${approval.id}/approve`, {})).statusCode).toBe(
      409,
    );
    expect(deletedIds()).not.toContain('11');
  });
});
