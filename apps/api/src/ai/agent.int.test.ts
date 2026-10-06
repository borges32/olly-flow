import { startMcpTestServer, type McpTestServer } from '@olly/mcp-test-server';
import type {
  AgentStep,
  AgentStepEvent,
  CredentialSummary,
  ExecutionAiUsage,
  ExecutionList,
  ProjectSummary,
  WorkflowNode,
} from '@olly/shared-types';
import { sql } from 'kysely';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentWorkflow, allowModels, fakeModelCredential, mcpToolNode } from '../testing/ai.js';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { registerMcpServer } from '../testing/mcp.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

const CPF = '529.982.247-25';

let ctx: TestContext;
let mcp: McpTestServer;
let url: string;
let admin: TestUser, editor: TestUser, executor: TestUser;
let project: ProjectSummary;
let serverId: string;
let pgCredentialId: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  mcp = await startMcpTestServer();
  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 },
  });
  url = await ctx.listen();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@agent.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@agent.local' });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@agent.local' });
  project = (await admin.call('POST', '/projects', { name: 'Agentes' })).json<ProjectSummary>();
  await allowModels(admin, ['fake-model', 'fake-model-2']);
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  await admin.call('PUT', `/projects/${project.id}/members/${executor.id}`, { role: 'executor' });
  serverId = (
    await registerMcpServer(
      admin,
      { name: 'Clientes MCP', transport: 'streamableHttp', url: `${mcp.url}/mcp` },
      { allow: ['consulta_cliente'] },
    )
  ).id;
  // Banco "externo" da ferramenta Postgres: o mesmo container do teste, numa tabela própria.
  await sql`CREATE TABLE pedidos (id serial PRIMARY KEY, cidade text NOT NULL, total numeric NOT NULL)`.execute(
    ctx.database.db,
  );
  await sql`INSERT INTO pedidos (cidade, total) VALUES ('Brasília', 120), ('Goiânia', 80), ('Brasília', 30)`.execute(
    ctx.database.db,
  );
  const db = new URL(ctx.database.connectionString);
  pgCredentialId = (
    await editor.call('POST', `/projects/${project.id}/credentials`, {
      name: 'Banco de pedidos',
      type: 'postgres',
      data: {
        host: db.hostname,
        port: Number(db.port),
        database: db.pathname.slice(1),
        user: decodeURIComponent(db.username),
        password: decodeURIComponent(db.password),
        readOnly: true,
      },
    })
  ).json<CredentialSummary>().id;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await ctx.close();
  await mcp.close();
});

const pgTool = (): WorkflowNode => ({
  id: 'tool-pg',
  type: 'tool.postgresQuery',
  name: 'Pedidos por cidade',
  params: {
    toolName: 'pedidos_por_cidade',
    toolDescription: 'Soma os pedidos de uma cidade',
    query:
      'SELECT $1::text AS cidade, count(*)::int AS pedidos, sum(total)::int AS total FROM pedidos WHERE cidade = $1',
    queryParameters: [{ value: "={{ $fromAI('cidade', 'Nome da cidade') }}" }],
  },
  credentialId: pgCredentialId,
  position: [700, 200],
});

describe('spec 011 — SC-001/FR-003/FR-005/FR-006/FR-007: agente com ferramentas', () => {
  it('SC-001: webhook → Agent usa as ferramentas Postgres e MCP e responde; passos no log', async () => {
    const credentialId = await fakeModelCredential(editor, project.id, [
      { toolCalls: [{ name: 'consulta_cliente', args: { id: '1' } }] },
      { toolCalls: [{ name: 'pedidos_por_cidade', args: { cidade: 'Brasília' } }] },
      { content: 'Cliente de Brasília com pedidos: {{lastTool}}' },
    ]);
    const definition = agentWorkflow({
      credentialId,
      tools: [mcpToolNode(serverId), pgTool()],
      trigger: {
        id: 'm',
        type: 'trigger.webhook',
        name: 'Pergunta',
        params: { httpMethod: 'POST', path: 'agente-sc001', responseMode: 'lastNode' },
        position: [0, 0],
      },
      agentParams: { text: '={{ $json.body.pergunta }}', returnIntermediateSteps: true },
    });
    const wf = await createWorkflow(editor, project.id, definition);
    expect(
      (await editor.call('POST', `/workflows/${wf.id}/publish`, { message: 'Agente' })).statusCode,
    ).toBe(200);

    // Passos em tempo real (FR-006): quem lê os dados recebe o conteúdo; o executor, não.
    const events: { editor: AgentStepEvent[]; executor: AgentStepEvent[] } = {
      editor: [],
      executor: [],
    };
    for (const [who, user] of [
      ['editor', editor],
      ['executor', executor],
    ] as const) {
      const socket = io(`${url}/executions`, {
        auth: { token: user.token },
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      socket.on('agentStep', (e: AgentStepEvent) => events[who].push(e));
      expect(await socket.emitWithAck('joinWorkflow', { workflowId: wf.id })).toEqual({ ok: true });
    }

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/webhook/agente-sc001',
      payload: { pergunta: 'Quem é o cliente 1 e quanto ele comprou em Brasília?' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      output: string;
      intermediateSteps: { action: { tool: string } }[];
      usage: unknown;
    }>();
    expect(body.output).toContain('"pedidos":2');
    expect(body.output).toContain('"total":150');
    expect(body.intermediateSteps.map((s) => s.action.tool)).toEqual([
      'consulta_cliente',
      'pedidos_por_cidade',
    ]);
    expect(body.usage).toMatchObject({ model: 'fake-model' });
    // O MCP recebeu a chamada (registrada em mcp_calls, spec 010).
    expect(mcp.calls.some((c) => c.tool === 'consulta_cliente')).toBe(true);

    const executionId =
      (await editor.call('GET', `/executions?workflowId=${wf.id}`)).json<ExecutionList>().items[0]
        ?.id ?? '';
    const steps = (await editor.call('GET', `/executions/${executionId}/agent-steps`)).json<
      AgentStep[]
    >();
    expect(steps.map((s) => [s.kind, s.toolName])).toEqual([
      ['model', null],
      ['tool', 'consulta_cliente'],
      ['model', null],
      ['tool', 'pedidos_por_cidade'],
      ['model', null],
      ['final', null],
    ]);
    // VIII.2: o CPF devolvido pelo MCP fica mascarado nos passos gravados.
    expect(JSON.stringify(steps)).not.toContain(CPF);
    expect(JSON.stringify(steps)).toContain('***.***.247-**');
    // Sem `execution:readData`, os passos vêm sem o conteúdo.
    const asExecutor = (await executor.call('GET', `/executions/${executionId}/agent-steps`)).json<
      AgentStep[]
    >();
    expect(asExecutor[0]).not.toHaveProperty('content');

    await expect.poll(() => events.editor.length).toBe(6);
    expect(JSON.stringify(events.editor)).not.toContain(CPF);
    expect(events.executor.every((e) => e.content === undefined && e.contentRedacted)).toBe(true);

    // FR-014: uso registrado por chamada ao modelo.
    const usage = (
      await editor.call('GET', `/executions/${executionId}/ai-usage`)
    ).json<ExecutionAiUsage>();
    expect(usage.calls).toBe(3);
    expect(usage.inputTokens).toBeGreaterThan(0);
  });

  it('FR-008: a ferramenta Postgres não aceita SQL vindo do modelo (SQL fixo, sem expressão)', async () => {
    const credentialId = await fakeModelCredential(editor, project.id, [{ content: 'x' }]);
    const tool = pgTool();
    tool.params = { ...tool.params, query: "={{ $fromAI('sql') }}" };
    const res = await editor.call('POST', `/projects/${project.id}/workflows`, {
      name: 'SQL do modelo',
      definition: agentWorkflow({ credentialId, tools: [tool] }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('não aceita expressões');
  });
});

describe('spec 011 — SC-005/SC-006/SC-007: limites do agente', () => {
  async function run(
    script: Parameters<typeof fakeModelCredential>[2],
    extra: Partial<Parameters<typeof agentWorkflow>[0]> = {},
  ) {
    const credentialId = await fakeModelCredential(editor, project.id, script);
    const wf = await createWorkflow(
      editor,
      project.id,
      agentWorkflow({ credentialId, pinData: { m: [{ json: { pergunta: 'oi' } }] }, ...extra }),
    );
    return waitForStatus(editor, await startTestRun(editor, wf));
  }

  it('SC-005: o laço de chamadas atinge o limite de iterações com erro explícito', async () => {
    const detail = await run(
      [{ toolCalls: [{ name: 'consulta_cliente', args: { id: '1' } }], repeat: true }],
      {
        tools: [mcpToolNode(serverId)],
        agentParams: { maxIterations: 3 },
      },
    );
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toBe(
      'O agente atingiu o limite de 3 iterações sem uma resposta final',
    );
  });

  it('SC-006: modelo fora da lista permitida é recusado (instalação e projeto)', async () => {
    const outside = await run([{ content: 'x' }], { model: 'gpt-4o' });
    expect(outside.status).toBe('error');
    expect(outside.error?.message).toContain('O modelo "gpt-4o" não está na lista permitida');
    // O projeto restringe a lista da instalação.
    expect(
      (
        await admin.call('PUT', `/projects/${project.id}/ai-settings`, {
          allowedModels: ['fake-model-2'],
          monthlyTokenLimit: null,
        })
      ).statusCode,
    ).toBe(200);
    const restricted = await run([{ content: 'x' }]);
    expect(restricted.error?.message).toContain('"fake-model" não está na lista permitida');
    await admin.call('PUT', `/projects/${project.id}/ai-settings`, {
      allowedModels: null,
      monthlyTokenLimit: null,
    });
    // Fora da lista da instalação, o projeto não pode liberar.
    expect(
      (
        await admin.call('PUT', `/projects/${project.id}/ai-settings`, {
          allowedModels: ['gpt-4o'],
          monthlyTokenLimit: null,
        })
      ).statusCode,
    ).toBe(422);
  });

  it('SC-007: resposta estruturada corrigida pelo modelo, ou falha após 2 tentativas', async () => {
    const schema = JSON.stringify({
      type: 'object',
      required: ['nota'],
      properties: { nota: { type: 'number' } },
    });
    const ok = await run([{ content: 'nota dez' }, { content: '{"nota": 10}' }], {
      agentParams: { outputParser: 'jsonSchema', schema },
    });
    expect(ok.status).toBe('success');
    expect(ok.nodes.find((n) => n.nodeId === 'agent')?.output?.main?.[0]?.json.output).toEqual({
      nota: 10,
    });
    const failed = await run([{ content: 'sem json', repeat: true }], {
      agentParams: { outputParser: 'jsonSchema', schema },
    });
    expect(failed.status).toBe('error');
    expect(failed.error?.message).toContain('após 2 correções');
  });
});
