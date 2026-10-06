import { GetObjectCommand } from '@aws-sdk/client-s3';
import { startMcpTestServer, type McpTestServer } from '@olly/mcp-test-server';
import type { McpCall, ProjectSummary } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { mcpWorkflow, registerMcpServer } from '../testing/mcp.js';
import { startTestMinio, type TestMinio } from '../testing/minio.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

const CPF = '529.982.247-25';

let ctx: TestContext;
let mcp: McpTestServer;
let minio: TestMinio;
let admin: TestUser, editor: TestUser, executor: TestUser;
let project: ProjectSummary;
let serverId: string;

beforeAll(async () => {
  [mcp, minio] = await Promise.all([startMcpTestServer(), startTestMinio()]);
  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 },
    s3: minio.config,
  });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@calls.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@calls.local' });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@calls.local' });
  project = (await admin.call('POST', '/projects', { name: 'Chamadas' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  await admin.call('PUT', `/projects/${project.id}/members/${executor.id}`, { role: 'executor' });
  serverId = (
    await registerMcpServer(
      admin,
      { name: 'Registro', transport: 'streamableHttp', url: `${mcp.url}/mcp` },
      { allow: ['consulta_cliente', 'erro', 'imagem'] },
    )
  ).id;
});
afterAll(async () => {
  await ctx.close();
  await Promise.all([mcp.close(), minio.stop()]);
});

async function run(params: Record<string, unknown>) {
  const wf = await createWorkflow(editor, project.id, mcpWorkflow(serverId, params));
  const executionId = await startTestRun(editor, wf);
  return { executionId, detail: await waitForStatus(editor, executionId) };
}

describe('spec 010 — FR-011/SC-007: toda chamada registrada com argumentos mascarados', () => {
  it('FR-011/SC-007: servidor, tool, argumentos mascarados, status, duração e tamanho', async () => {
    const { executionId, detail } = await run({
      toolName: 'consulta_cliente',
      arguments: { id: '1', cpf: CPF },
    });
    expect(detail.status).toBe('success');
    // O servidor recebeu o CPF original (o mascaramento não altera os dados entre nós).
    expect(mcp.calls.find((c) => c.tool === 'consulta_cliente')?.args).toEqual({
      id: '1',
      cpf: CPF,
    });

    const calls = (await editor.call('GET', `/executions/${executionId}/mcp-calls`)).json<
      McpCall[]
    >();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      nodeId: 'mcp',
      runIndex: 0,
      itemIndex: 0,
      serverId,
      serverName: 'Registro',
      operation: 'callTool',
      target: 'consulta_cliente',
      arguments: { id: '1', cpf: '***.***.247-**' },
      status: 'success',
      error: null,
    });
    expect(calls[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(calls[0]?.resultBytes).toBeGreaterThan(0);

    // No banco, nunca o valor original.
    const rows = await ctx.database.db
      .selectFrom('mcp_calls')
      .select('arguments')
      .where('execution_id', '=', executionId)
      .execute();
    expect(JSON.stringify(rows)).not.toContain(CPF);

    // Sem `execution:readData`, a chamada aparece sem os argumentos.
    const asExecutor = (await executor.call('GET', `/executions/${executionId}/mcp-calls`)).json<
      McpCall[]
    >();
    expect(asExecutor[0]).not.toHaveProperty('arguments');
    expect(asExecutor[0]?.target).toBe('consulta_cliente');
  });

  it('FR-011/FR-010: isError fica registrado como erro e falha o nó', async () => {
    const { executionId, detail } = await run({ toolName: 'erro', arguments: {} });
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toBe('Falha simulada pela tool');
    const [call] = (await editor.call('GET', `/executions/${executionId}/mcp-calls`)).json<
      McpCall[]
    >();
    expect(call).toMatchObject({ status: 'error', error: 'Falha simulada pela tool' });
  });

  it('FR-011: chamadas de outra execução ou sem acesso ao projeto não aparecem', async () => {
    const outsider = await loginAs(ctx, { sub: 'fora', email: 'fora@calls.local' });
    const { executionId } = await run({ toolName: 'consulta_cliente', arguments: { id: '2' } });
    expect((await outsider.call('GET', `/executions/${executionId}/mcp-calls`)).statusCode).toBe(
      404,
    );
  });
});

describe('spec 010 — FR-010: conteúdo binário', () => {
  it('FR-010: a imagem devolvida vai para o object storage e fica referenciada no item', async () => {
    const { detail } = await run({ toolName: 'imagem', arguments: {} });
    expect(detail.status).toBe('success');
    const item = detail.nodes.find((n) => n.nodeId === 'mcp')?.output?.main?.[0];
    expect(item?.json.content).toEqual([
      { type: 'text', text: 'Um pixel' },
      { type: 'image', mimeType: 'image/png', binaryProperty: 'data' },
    ]);
    const ref = item?.binary?.data;
    expect(ref).toMatchObject({ mimeType: 'image/png' });
    // O PNG de 1×1 do servidor de teste, decodificado do base64, está no MinIO.
    const object = await minio.s3.send(
      new GetObjectCommand({ Bucket: 'olly', Key: ref?.id ?? '' }),
    );
    const bytes = await object.Body?.transformToByteArray();
    expect(
      Buffer.from(bytes ?? [])
        .subarray(1, 4)
        .toString(),
    ).toBe('PNG');
    // O base64 não fica nos dados do nó.
    expect(JSON.stringify(item?.json)).not.toContain('iVBORw0KGgo');
  });
});
