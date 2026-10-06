import { startMcpTestServer, type McpTestServer } from '@olly/mcp-test-server';
import type { CredentialSummary, McpServerTestResponse, ProjectSummary } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { mcpWorkflow, registerMcpServer } from '../testing/mcp.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let mcp: McpTestServer;
let admin: TestUser, editor: TestUser;
let project: ProjectSummary;

beforeAll(async () => {
  mcp = await startMcpTestServer();
  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 },
    mcp: { callTimeoutMs: 3000, maxResultBytes: 256 * 1024 },
  });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@tr.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@tr.local' });
  project = (await admin.call('POST', '/projects', { name: 'Transportes' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
});
afterAll(async () => {
  await ctx.close();
  await mcp.close();
});

async function run(serverId: string, params: Record<string, unknown>, credentialId?: string) {
  const wf = await createWorkflow(
    editor,
    project.id,
    mcpWorkflow(serverId, params, credentialId ? { credentialId } : {}),
  );
  const executionId = await startTestRun(editor, wf);
  return { executionId, detail: await waitForStatus(editor, executionId) };
}

const output = (detail: Awaited<ReturnType<typeof run>>['detail']) =>
  detail.nodes.find((n) => n.nodeId === 'mcp')?.output?.main?.[0]?.json;

describe('spec 010 — FR-004/SC-001: chamada via HTTP', () => {
  it('SC-001: soma via Streamable HTTP com argumentos de expressões', async () => {
    const server = await registerMcpServer(
      admin,
      { name: 'HTTP', transport: 'streamableHttp', url: `${mcp.url}/mcp` },
      { allow: ['soma'] },
    );
    const { detail } = await run(server.id, {
      toolName: 'soma',
      arguments: { a: '={{ 40 }}', b: '={{ 1 + 1 }}' },
    });
    expect(detail.status).toBe('success');
    expect(output(detail)).toEqual({
      content: [{ type: 'text', text: '42' }],
      structuredContent: { resultado: 42 },
      isError: false,
    });
  });

  it('FR-004: SSE legado também funciona', async () => {
    const server = await registerMcpServer(
      admin,
      { name: 'SSE', transport: 'sse', url: `${mcp.url}/sse` },
      { allow: ['echo'] },
    );
    const { detail } = await run(server.id, { toolName: 'echo', arguments: { texto: 'olá' } });
    expect(detail.status).toBe('success');
    expect(output(detail)).toMatchObject({ content: [{ type: 'text', text: 'olá' }] });
  });

  it('FR-008: listar tools (só as liberadas), ler resource e obter prompt', async () => {
    const server = await registerMcpServer(
      admin,
      { name: 'Operações', transport: 'streamableHttp', url: `${mcp.url}/mcp` },
      { allow: ['soma'] },
    );
    const tools = output((await run(server.id, { operation: 'listTools' })).detail);
    expect((tools?.tools as { name: string }[]).map((t) => t.name)).toEqual(['soma']);
    const resource = output(
      (await run(server.id, { operation: 'readResource', resourceUri: 'test://info' })).detail,
    );
    expect(resource).toMatchObject({ contents: [{ text: 'Servidor MCP de teste do Olly Flow' }] });
    const prompt = output(
      (
        await run(server.id, {
          operation: 'getPrompt',
          promptName: 'saudacao',
          promptArguments: [{ name: 'nome', value: 'Bia' }],
        })
      ).detail,
    );
    expect(JSON.stringify(prompt)).toContain('Diga olá para Bia.');
  });

  it('SC-004: argumento inválido falha antes de chegar ao servidor', async () => {
    const server = await registerMcpServer(
      admin,
      { name: 'Validação', transport: 'streamableHttp', url: `${mcp.url}/mcp` },
      { allow: ['soma'] },
    );
    const before = mcp.calls.length;
    const { detail } = await run(server.id, { toolName: 'soma', arguments: { a: 'x' } });
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toBe('Argumentos inválidos para a tool "soma"');
    expect(mcp.calls.slice(before).some((c) => c.tool === 'soma')).toBe(false);
  });
});

describe('spec 010 — FR-004/SC-005: anti-SSRF', () => {
  it('SC-005: servidor com IP interno não liberado é bloqueado (teste e execução)', async () => {
    const created = await admin.call('POST', '/mcp-servers', {
      name: 'Metadados',
      transport: 'streamableHttp',
      url: 'http://169.254.169.254/mcp',
    });
    const id = created.json<{ id: string }>().id;
    const test = (
      await admin.call('POST', `/mcp-servers/${id}/test`)
    ).json<McpServerTestResponse>();
    expect(test.ok).toBe(false);
    expect(test.message).toMatch(/bloqueado pelo filtro de rede \(169\.254\.169\.254\)/);
    const approve = await admin.call('POST', `/mcp-servers/${id}/approve`);
    expect(approve.statusCode).toBe(422);
    expect(approve.body).toContain('bloqueado pelo filtro de rede');

    // Mesmo um servidor aprovado que passe a apontar para um IP interno é barrado na execução.
    const server = await registerMcpServer(
      admin,
      { name: 'Muda de endereço', transport: 'streamableHttp', url: `${mcp.url}/mcp` },
      { allow: ['soma'] },
    );
    await ctx.database.db
      .updateTable('mcp_servers')
      .set({ url: 'http://10.0.0.7/mcp', updated_at: new Date() })
      .where('id', '=', server.id)
      .execute();
    const { detail } = await run(server.id, { toolName: 'soma', arguments: { a: 1, b: 1 } });
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toMatch(/bloqueado pelo filtro de rede \(10\.0\.0\.7\)/);
  });
});

describe('spec 010 — FR-006/NFR-001: timeout, cancelamento e limite', () => {
  it('FR-006: timeout por chamada (cancelado também no servidor)', async () => {
    const server = await registerMcpServer(
      admin,
      { name: 'Lento', transport: 'streamableHttp', url: `${mcp.url}/mcp` },
      { allow: ['lento'] },
    );
    const cancelled = mcp.calls.filter((c) => c.tool === 'lento:cancelado').length;
    const { detail } = await run(server.id, { toolName: 'lento', arguments: { ms: 20_000 } });
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toBe('O servidor MCP não respondeu em 3 s');
    await expect
      .poll(() => mcp.calls.filter((c) => c.tool === 'lento:cancelado').length)
      .toBe(cancelled + 1);
  });

  it('FR-006: cancelar a execução envia notifications/cancelled ao servidor', async () => {
    const server = await registerMcpServer(
      admin,
      { name: 'Cancelável', transport: 'streamableHttp', url: `${mcp.url}/mcp` },
      { allow: ['lento'] },
    );
    const cancelled = mcp.calls.filter((c) => c.tool === 'lento:cancelado').length;
    const calls = mcp.calls.filter((c) => c.tool === 'lento').length;
    const wf = await createWorkflow(
      editor,
      project.id,
      mcpWorkflow(server.id, { toolName: 'lento', arguments: { ms: 2500 } }),
    );
    const executionId = await startTestRun(editor, wf);
    await expect.poll(() => mcp.calls.filter((c) => c.tool === 'lento').length).toBe(calls + 1);
    expect((await editor.call('POST', `/executions/${executionId}/cancel`)).statusCode).toBe(202);
    expect((await waitForStatus(editor, executionId)).status).toBe('cancelled');
    await expect
      .poll(() => mcp.calls.filter((c) => c.tool === 'lento:cancelado').length)
      .toBe(cancelled + 1);
  });

  it('FR-006: resultado acima de OLLY_MCP_MAX_RESULT_MB é recusado', async () => {
    const server = await registerMcpServer(
      admin,
      { name: 'Grande', transport: 'streamableHttp', url: `${mcp.url}/mcp` },
      { allow: ['grande'] },
    );
    const { detail } = await run(server.id, { toolName: 'grande', arguments: { kb: 1024 } });
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toBe('Resultado do servidor MCP acima do limite de 0.3 MB');
  });
});

describe('spec 010 — FR-007: servidores autenticados por token e cabeçalhos', () => {
  it('FR-007: credencial mcpBearer (do catálogo) e mcpHeaders (do nó)', async () => {
    const bearerServer = await startMcpTestServer({
      auth: { kind: 'bearer', token: 's3cr3t-mcp' },
    });
    const headerServer = await startMcpTestServer({
      auth: { kind: 'header', name: 'X-Api-Key', value: 'chave-mcp-123' },
    });
    try {
      const bearer = (
        await admin.call('POST', `/projects/${project.id}/credentials`, {
          name: 'MCP bearer',
          type: 'mcpBearer',
          data: { token: 's3cr3t-mcp' },
        })
      ).json<CredentialSummary>();
      const headers = (
        await admin.call('POST', `/projects/${project.id}/credentials`, {
          name: 'MCP headers',
          type: 'mcpHeaders',
          data: { headers: 'X-Api-Key: chave-mcp-123\nX-Outro: valor' },
        })
      ).json<CredentialSummary>();

      // Sem credencial, o servidor recusa.
      const noAuth = await registerMcpServer(
        admin,
        { name: 'Sem token', transport: 'streamableHttp', url: `${bearerServer.url}/mcp` },
        { approve: false },
      );
      const denied = (
        await admin.call('POST', `/mcp-servers/${noAuth.id}/test`)
      ).json<McpServerTestResponse>();
      expect(denied.ok).toBe(false);

      const withBearer = await registerMcpServer(
        admin,
        {
          name: 'Com token',
          transport: 'streamableHttp',
          url: `${bearerServer.url}/mcp`,
          credentialId: bearer.id,
        },
        { allow: ['soma'] },
      );
      expect(
        (await run(withBearer.id, { toolName: 'soma', arguments: { a: 1, b: 2 } })).detail.status,
      ).toBe('success');

      // A aprovação usa a credencial do catálogo; na execução, a do nó prevalece.
      const headersCatalog = await admin.call('POST', `/projects/${project.id}/credentials`, {
        name: 'MCP headers catálogo',
        type: 'mcpHeaders',
        data: { headers: 'X-Api-Key: chave-mcp-123' },
      });
      const withHeaders = await registerMcpServer(
        admin,
        {
          name: 'Com cabeçalho',
          transport: 'streamableHttp',
          url: `${headerServer.url}/mcp`,
          credentialId: headersCatalog.json<CredentialSummary>().id,
        },
        { allow: ['echo'] },
      );
      const { detail } = await run(
        withHeaders.id,
        { toolName: 'echo', arguments: { texto: 'autenticado' } },
        headers.id,
      );
      expect(detail.status).toBe('success');
      // Os segredos nunca aparecem nos dados gravados.
      expect(JSON.stringify(detail)).not.toContain('chave-mcp-123');
      expect(JSON.stringify(detail)).not.toContain('s3cr3t-mcp');
    } finally {
      await bearerServer.close();
      await headerServer.close();
    }
  });
});
