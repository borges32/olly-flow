import { startMcpTestServer, type McpTestServer } from '@olly/mcp-test-server';
import type { McpServer, McpToolView, ProjectSummary } from '@olly/shared-types';
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
  });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@snap.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@snap.local' });
  project = (await admin.call('POST', '/projects', { name: 'Snapshot' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
});
afterAll(async () => {
  await ctx.close();
  await mcp.close();
});

async function run(serverId: string, args: Record<string, unknown>) {
  const wf = await createWorkflow(
    editor,
    project.id,
    mcpWorkflow(serverId, { toolName: 'soma', arguments: args }),
  );
  return waitForStatus(editor, await startTestRun(editor, wf));
}

describe('spec 010 — FR-003/SC-003: mudança de tool liberada bloqueia até a revisão', () => {
  it('FR-003/SC-003: schema alterado no servidor bloqueia a chamada, mostra o diff e libera ao aceitar', async () => {
    const server = await registerMcpServer(
      admin,
      { name: 'Snapshot', transport: 'streamableHttp', url: `${mcp.url}/mcp` },
      { allow: ['soma', 'echo'] },
    );
    const ok = await run(server.id, { a: 2, b: 3 });
    expect(ok.status).toBe('success');
    expect(ok.nodes.find((n) => n.nodeId === 'mcp')?.output?.main?.[0]?.json).toMatchObject({
      structuredContent: { resultado: 5 },
    });

    // *Rug pull*: o servidor muda a descrição e o schema de `soma` (sessões abertas são avisadas).
    mcp.setMutateSchema(true);
    const before = mcp.calls.filter((c) => c.tool === 'soma').length;
    const blocked = await run(server.id, { a: 2, b: 3, c: 4 });
    expect(blocked.status).toBe('error');
    expect(blocked.error?.message).toContain(
      'A tool "soma" do servidor MCP "Snapshot" mudou desde a aprovação',
    );
    // A chamada não chegou ao servidor.
    expect(mcp.calls.filter((c) => c.tool === 'soma')).toHaveLength(before);

    // O diff fica para revisão: descrição e schema, antes e depois.
    const detail = (await admin.call('GET', `/mcp-servers/${server.id}`)).json<McpServer>();
    const change = detail.pendingDiff?.changes.find((c) => c.name === 'soma');
    expect(change?.kind).toBe('changed');
    expect(change?.before?.description).toBe('Soma dois números.');
    expect(change?.after?.description).toContain('~/.ssh');
    expect(Object.keys(change?.after?.inputSchema.properties ?? {})).toContain('c');
    const tools = (await admin.call('GET', `/mcp-servers/${server.id}/tools`)).json<
      McpToolView[]
    >();
    expect(tools.find((t) => t.name === 'soma')).toMatchObject({
      changed: true,
      policy: { allowed: true },
    });
    // Só a tool alterada é bloqueada; as demais seguem funcionando.
    expect(tools.find((t) => t.name === 'echo')?.changed).toBe(false);

    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', server.id)
      .where('action', '=', 'mcp.tool_blocked')
      .execute();
    expect(audit).toHaveLength(1);

    // Revisão: aceitar a mudança atualiza o snapshot e libera as chamadas.
    const accepted = await admin.call('POST', `/mcp-servers/${server.id}/snapshot/accept`);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<McpServer>().pendingDiff).toBeNull();
    const after = await run(server.id, { a: 2, b: 3, c: 4 });
    expect(after.status).toBe('success');
    expect(after.nodes.find((n) => n.nodeId === 'mcp')?.output?.main?.[0]?.json).toMatchObject({
      structuredContent: { resultado: 9 },
    });
    expect((await admin.call('POST', `/mcp-servers/${server.id}/snapshot/accept`)).statusCode).toBe(
      409,
    );
    mcp.setMutateSchema(false);
  });

  it('FR-003: tool nova no servidor não bloqueia nada e continua negada', async () => {
    const fresh = await startMcpTestServer();
    try {
      const server = await registerMcpServer(
        admin,
        { name: 'Novas', transport: 'streamableHttp', url: `${fresh.url}/mcp` },
        { allow: ['soma'] },
      );
      // Simula uma tool nova removendo `echo` do snapshot aprovado.
      const row = await ctx.database.db
        .selectFrom('mcp_servers')
        .select('tools_snapshot')
        .where('id', '=', server.id)
        .executeTakeFirstOrThrow();
      const snapshot = { ...(row.tools_snapshot as Record<string, unknown>) };
      delete snapshot.echo;
      await ctx.database.db
        .updateTable('mcp_servers')
        .set({ tools_snapshot: JSON.stringify(snapshot), updated_at: new Date() })
        .where('id', '=', server.id)
        .execute();
      expect((await run(server.id, { a: 1, b: 1 })).status).toBe('success');
      const tools = (await admin.call('GET', `/mcp-servers/${server.id}/tools`)).json<
        McpToolView[]
      >();
      expect(tools.find((t) => t.name === 'echo')).toMatchObject({
        changed: true,
        policy: { allowed: false },
      });
    } finally {
      await fresh.close();
    }
  });
});
