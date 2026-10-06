import { startMcpTestServer, type McpTestServer } from '@olly/mcp-test-server';
import type {
  McpServer,
  McpServerOption,
  McpServerTestResponse,
  McpToolView,
  ProjectSummary,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { mcpWorkflow, registerMcpServer } from '../testing/mcp.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let mcp: McpTestServer;
let admin: TestUser, editor: TestUser, executor: TestUser, viewer: TestUser;
let project: ProjectSummary;
let other: ProjectSummary;

beforeAll(async () => {
  mcp = await startMcpTestServer();
  // O servidor de teste é local: liberado na allowlist do anti-SSRF, como um servidor interno.
  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 },
  });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@mcp.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@mcp.local' });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@mcp.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@mcp.local' });
  project = (await admin.call('POST', '/projects', { name: 'MCP' })).json<ProjectSummary>();
  other = (await admin.call('POST', '/projects', { name: 'Outro MCP' })).json<ProjectSummary>();
  for (const p of [project, other]) {
    await admin.call('PUT', `/projects/${p.id}/members/${editor.id}`, { role: 'editor' });
  }
  await admin.call('PUT', `/projects/${project.id}/members/${executor.id}`, { role: 'executor' });
  await admin.call('PUT', `/projects/${project.id}/members/${viewer.id}`, { role: 'viewer' });
});
afterAll(async () => {
  await ctx.close();
  await mcp.close();
});

const input = (name: string) => ({
  name,
  description: 'Servidor de teste',
  transport: 'streamableHttp' as const,
  url: `${mcp.url}/mcp`,
});

describe('spec 010 — FR-001/HU-1: catálogo de servidores MCP', () => {
  it('FR-001/HU-1.1: cadastra pendente, testa (capacidades e tools) e aprova com snapshot', async () => {
    const created = await admin.call('POST', '/mcp-servers', input('Catálogo'));
    expect(created.statusCode).toBe(201);
    const server = created.json<McpServer>();
    expect(server).toMatchObject({ status: 'pending', projectId: null, toolCount: 0 });

    const test = (
      await admin.call('POST', `/mcp-servers/${server.id}/test`)
    ).json<McpServerTestResponse>();
    expect(test.ok).toBe(true);
    expect(test.serverInfo).toMatchObject({
      name: 'olly-mcp-test-server',
      protocolVersion: '2025-11-25',
    });
    expect(test.serverInfo?.capabilities).toHaveProperty('tools');
    expect(test.tools?.map((t) => t.name)).toEqual(expect.arrayContaining(['soma', 'echo']));

    const approved = (
      await admin.call('POST', `/mcp-servers/${server.id}/approve`)
    ).json<McpServer>();
    expect(approved.status).toBe('active');
    expect(approved.approvedBy).toBe(admin.id);
    expect(approved.toolCount).toBe(test.tools?.length);

    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', server.id)
      .orderBy('id')
      .execute();
    expect(audit.map((a) => a.action)).toEqual([
      'mcp.server_create',
      'mcp.server_test',
      'mcp.server_approve',
    ]);
  });

  it('FR-005: o transporte stdio é recusado no cadastro (somente HTTP nesta versão)', async () => {
    const res = await admin.call('POST', '/mcp-servers', {
      ...input('Local'),
      transport: 'stdio',
      url: 'http://ignorado/mcp',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('stdio não é suportado');
  });

  it('FR-001: trocar a URL de um servidor aprovado exige nova aprovação', async () => {
    const server = await registerMcpServer(admin, input('Troca'));
    const res = await admin.call('PUT', `/mcp-servers/${server.id}`, {
      ...input('Troca'),
      url: `${mcp.url}/mcp?v=2`,
    });
    expect(res.json<McpServer>()).toMatchObject({
      status: 'pending',
      toolCount: 0,
      approvedBy: null,
    });
    const update = await ctx.database.db
      .selectFrom('audit_log')
      .select('details')
      .where('entity_id', '=', server.id)
      .where('action', '=', 'mcp.server_update')
      .executeTakeFirstOrThrow();
    expect(update.details).toMatchObject({ reapprovalRequired: true });
  });

  it('T089/FR-001: editor, executor e visualizador recebem 403 na gestão do catálogo', async () => {
    const server = await registerMcpServer(admin, input('RBAC'));
    for (const user of [editor, executor, viewer]) {
      expect((await user.call('GET', '/mcp-servers')).statusCode).toBe(403);
      expect((await user.call('POST', '/mcp-servers', input('x'))).statusCode).toBe(403);
      expect((await user.call('POST', `/mcp-servers/${server.id}/approve`)).statusCode).toBe(403);
      expect(
        (await user.call('PUT', `/mcp-servers/${server.id}/policies`, { policies: [] })).statusCode,
      ).toBe(403);
    }
  });
});

describe('spec 010 — FR-002: tools negadas por padrão, liberadas por servidor e projeto', () => {
  it('FR-002: sem política tudo é negado; a do projeto prevalece sobre a global', async () => {
    const server = await registerMcpServer(admin, input('Políticas'));
    const tools = async (projectId?: string) =>
      (
        await admin.call(
          'GET',
          `/mcp-servers/${server.id}/tools${projectId ? `?projectId=${projectId}` : ''}`,
        )
      ).json<McpToolView[]>();
    expect((await tools()).every((t) => !t.policy.allowed && t.policy.source === 'default')).toBe(
      true,
    );

    await admin.call('PUT', `/mcp-servers/${server.id}/policies`, {
      policies: [
        { toolName: 'soma', allowed: true, destructive: false },
        { toolName: 'apagar_registro', allowed: true, destructive: true },
      ],
    });
    await admin.call('PUT', `/mcp-servers/${server.id}/policies`, {
      projectId: other.id,
      policies: [{ toolName: 'soma', allowed: false, destructive: false }],
    });
    const global = await tools();
    expect(global.find((t) => t.name === 'apagar_registro')?.policy).toEqual({
      allowed: true,
      destructive: true,
      source: 'global',
    });
    const inOther = await tools(other.id);
    expect(inOther.find((t) => t.name === 'soma')?.policy).toMatchObject({
      allowed: false,
      source: 'project',
    });
    expect((await tools(project.id)).find((t) => t.name === 'soma')?.policy.allowed).toBe(true);

    // Para quem monta workflows: só as tools liberadas no projeto (credential:use).
    const available = (await editor.call('GET', `/projects/${project.id}/mcp-servers`)).json<
      McpServerOption[]
    >();
    expect(
      available
        .find((s) => s.id === server.id)
        ?.tools.map((t) => t.name)
        .sort(),
    ).toEqual(['apagar_registro', 'soma']);
    const inOtherProject = (await editor.call('GET', `/projects/${other.id}/mcp-servers`)).json<
      McpServerOption[]
    >();
    expect(inOtherProject.find((s) => s.id === server.id)?.tools.map((t) => t.name)).toEqual([
      'apagar_registro',
    ]);
    expect((await executor.call('GET', `/projects/${project.id}/mcp-servers`)).statusCode).toBe(
      403,
    );

    // Constituição VII.3: mudanças de política são auditadas.
    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select(['action', 'details'])
      .where('entity_id', '=', server.id)
      .where('action', '=', 'mcp.policy_update')
      .orderBy('id')
      .execute();
    expect(audit).toHaveLength(2);
    expect(audit[1]?.details).toMatchObject({ projectId: other.id });
  });

  it('FR-002: só tools do snapshot aprovado podem ser liberadas', async () => {
    const server = await registerMcpServer(admin, input('Fora do snapshot'));
    const res = await admin.call('PUT', `/mcp-servers/${server.id}/policies`, {
      policies: [{ toolName: 'inexistente', allowed: true, destructive: false }],
    });
    expect(res.statusCode).toBe(422);
  });

  it('FR-012/SC-002: tool não liberada é recusada no workflow e auditada', async () => {
    const server = await registerMcpServer(admin, input('Negação'), { allow: ['soma'] });
    const before = mcp.calls.length;
    const wf = await createWorkflow(
      editor,
      project.id,
      mcpWorkflow(server.id, { toolName: 'apagar_registro', arguments: { id: '42' } }),
    );
    const detail = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toContain(
      `Tool "apagar_registro" do servidor MCP "Negação" não está liberada para este projeto`,
    );
    // A tool não chegou ao servidor.
    expect(mcp.calls.slice(before).some((c) => c.tool === 'apagar_registro')).toBe(false);

    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'mcp.tool_denied')
      .where('entity_id', '=', server.id)
      .executeTakeFirstOrThrow();
    expect(audit.user_id).toBe(editor.id);
    expect(audit.details).toMatchObject({ tool: 'apagar_registro', projectId: project.id });
    const call = await ctx.database.db
      .selectFrom('mcp_calls')
      .selectAll()
      .where('server_id', '=', server.id)
      .executeTakeFirstOrThrow();
    expect(call).toMatchObject({ status: 'denied', target: 'apagar_registro', node_id: 'mcp' });
  });

  it('FR-001: servidor pendente, desativado ou de outro projeto não é usado', async () => {
    const pending = await registerMcpServer(admin, input('Pendente'), { approve: false });
    const scoped = await registerMcpServer(
      admin,
      { ...input('Só do outro'), projectId: other.id },
      { allow: ['soma'], projectId: other.id },
    );
    const run = async (serverId: string) => {
      const wf = await createWorkflow(
        editor,
        project.id,
        mcpWorkflow(serverId, { toolName: 'soma', arguments: { a: 1, b: 2 } }),
      );
      return waitForStatus(editor, await startTestRun(editor, wf));
    };
    expect((await run(pending.id)).error?.message).toContain('aguardando aprovação');
    expect((await run(scoped.id)).error?.message).toContain('não encontrado neste projeto');
    await admin.call('POST', `/mcp-servers/${scoped.id}/disable`);
    const wf = await createWorkflow(
      editor,
      other.id,
      mcpWorkflow(scoped.id, { toolName: 'soma', arguments: { a: 1, b: 2 } }),
    );
    expect((await waitForStatus(editor, await startTestRun(editor, wf))).error?.message).toContain(
      'desativado',
    );
  });
});
