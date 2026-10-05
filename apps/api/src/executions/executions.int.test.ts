import type {
  ExecutionDetail,
  ExecutionList,
  ExpressionPreviewResponse,
  NodeFinishedEvent,
  ProjectSummary,
  TestRunResponse,
  TestWebhookReceivedEvent,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let admin: TestUser, editor: TestUser, executor: TestUser, viewer: TestUser, outsider: TestUser;
let project: ProjectSummary, other: ProjectSummary;
let wfA: WorkflowDetail, wfB: WorkflowDetail;
const sockets: Socket[] = [];

const definition: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 's',
      type: 'data.set',
      name: 'Montar',
      params: {
        fields: [{ name: 'cpf', type: 'string', value: '123.456.789-00' }],
        includeOtherFields: true,
      },
      position: [200, 0],
    },
  ],
  edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 's', toPort: 'main' }],
  settings: {},
};

async function finish(user: TestUser, executionId: string): Promise<ExecutionDetail> {
  for (let i = 0; i < 100; i++) {
    const d = (await user.call('GET', `/executions/${executionId}`)).json<ExecutionDetail>();
    if (!['running', 'queued'].includes(d.status)) return d;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('execução não terminou');
}
const testRun = async (user: TestUser, wf: WorkflowDetail, def = definition) =>
  finish(
    user,
    (
      await user.call('POST', `/workflows/${wf.id}/test-run`, { definition: def })
    ).json<TestRunResponse>().executionId,
  );

beforeAll(async () => {
  ctx = await startTestContext();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@t.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@t.local' });
  outsider = await loginAs(ctx, { sub: 'outsider', email: 'outsider@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'Execuções' })).json<ProjectSummary>();
  other = (await admin.call('POST', '/projects', { name: 'Outro' })).json<ProjectSummary>();
  for (const [u, role] of [
    [editor, 'editor'],
    [executor, 'executor'],
    [viewer, 'viewer'],
  ] as const) {
    await admin.call('PUT', `/projects/${project.id}/members/${u.id}`, { role });
  }
  wfA = (
    await editor.call('POST', `/projects/${project.id}/workflows`, { name: 'A', definition })
  ).json<WorkflowDetail>();
  wfB = (
    await editor.call('POST', `/projects/${project.id}/workflows`, { name: 'B', definition })
  ).json<WorkflowDetail>();
  const wfOther = (
    await admin.call('POST', `/projects/${other.id}/workflows`, { name: 'Outro', definition })
  ).json<WorkflowDetail>();
  await testRun(editor, wfA);
  await testRun(executor, wfA);
  await testRun(editor, wfB, { ...definition, nodes: [definition.nodes[0] as never], edges: [] });
  await testRun(admin, wfOther);
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await ctx.close();
});

const list = async (user: TestUser, query = '') =>
  (await user.call('GET', `/executions${query}`)).json<ExecutionList>();

describe('spec 005 — FR-013: listagem de execuções', () => {
  it('FR-013: filtros por projeto, workflow, status, modo, gatilho, usuário e período', async () => {
    const all = await list(editor, `?projectId=${project.id}`);
    expect(all.items).toHaveLength(3);
    expect(all.items[0]).toMatchObject({
      workflowName: expect.any(String) as string,
      mode: 'test',
      triggerType: 'manual',
    });
    expect(all.items.every((i) => typeof i.durationMs === 'number')).toBe(true);
    expect((await list(editor, `?workflowId=${wfA.id}`)).items).toHaveLength(2);
    expect((await list(editor, `?workflowId=${wfA.id}&userId=${executor.id}`)).items).toHaveLength(
      1,
    );
    expect(
      (await list(editor, `?projectId=${project.id}&status=success&mode=test&trigger=manual`))
        .items,
    ).toHaveLength(3);
    expect((await list(editor, `?projectId=${project.id}&mode=production`)).items).toHaveLength(0);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(
      (await list(editor, `?projectId=${project.id}&from=${encodeURIComponent(future)}`)).items,
    ).toHaveLength(0);
    expect(
      (await list(editor, `?projectId=${project.id}&to=${encodeURIComponent(future)}`)).items,
    ).toHaveLength(3);
    expect((await editor.call('GET', '/executions?status=talvez')).statusCode).toBe(400);
  });

  it('FR-013: paginação por cursor, mais recentes primeiro', async () => {
    const page1 = await list(editor, `?projectId=${project.id}&limit=2`);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await list(
      editor,
      `?projectId=${project.id}&limit=2&cursor=${page1.nextCursor ?? ''}`,
    );
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    const ids = [...page1.items, ...page2.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
    expect(
      page1.items[0]?.startedAt.localeCompare(page2.items[0]?.startedAt ?? ''),
    ).toBeGreaterThanOrEqual(0);
  });

  it('FR-013: cada um vê só os projetos em que tem execution:read', async () => {
    expect((await list(viewer)).items).toHaveLength(3);
    expect((await list(viewer, `?projectId=${other.id}`)).items).toHaveLength(0);
    expect((await list(admin)).items).toHaveLength(4);
    expect((await outsider.call('GET', '/executions')).statusCode).toBe(403);
  });
});

describe('spec 005 — FR-014: dados de execução exigem execution:readData', () => {
  it('FR-014: editor vê os dados; executor e visualizador recebem dataRedacted', async () => {
    const [last] = (await list(editor, `?workflowId=${wfA.id}`)).items;
    const full = (
      await editor.call('GET', `/executions/${last?.id ?? ''}`)
    ).json<ExecutionDetail>();
    expect(full.dataRedacted).toBe(false);
    expect(full.definition?.nodes).toHaveLength(2);
    expect(full.nodes.find((n) => n.nodeId === 's')?.output?.main?.[0]?.json.cpf).toBe(
      '123.456.789-00',
    );
    for (const user of [executor, viewer]) {
      const detail = (
        await user.call('GET', `/executions/${last?.id ?? ''}`)
      ).json<ExecutionDetail>();
      expect(detail.dataRedacted).toBe(true);
      expect(detail.status).toBe('success');
      expect(
        detail.nodes.every((n) => n.input === null && n.output === null && n.console === null),
      ).toBe(true);
      expect(JSON.stringify(detail.nodes)).not.toContain('123.456.789-00');
    }
  });

  it('FR-014: o preview de expressão ignora a execução para quem não tem execution:readData', async () => {
    const [last] = (await list(editor, `?workflowId=${wfA.id}`)).items;
    const body = { definition, nodeId: 's', expression: '={{ $json.cpf }}', executionId: last?.id };
    const asEditor = await editor.call('POST', `/workflows/${wfA.id}/expressions/preview`, {
      ...body,
      expression: "={{ $('Montar').first().json.cpf }}",
    });
    expect(asEditor.json<ExpressionPreviewResponse>()).toEqual({
      ok: true,
      value: '123.456.789-00',
    });
    const asExecutor = await executor.call('POST', `/workflows/${wfA.id}/expressions/preview`, {
      ...body,
      expression: "={{ $('Montar').isExecuted }}",
    });
    expect(asExecutor.json<ExpressionPreviewResponse>()).toEqual({ ok: true, value: false });
  });

  it('FR-014: em tempo real, quem não tem execution:readData recebe os eventos sem dados', async () => {
    const url = await ctx.listen();
    const connect = (user: TestUser) =>
      new Promise<Socket>((resolve, reject) => {
        const socket = io(`${url}/executions`, {
          auth: { token: user.token },
          transports: ['websocket'],
          reconnection: false,
        });
        sockets.push(socket);
        socket.once('connect', () => {
          resolve(socket);
        });
        socket.once('connect_error', reject);
      });
    const [editorSocket, executorSocket] = await Promise.all([connect(editor), connect(executor)]);
    for (const s of [editorSocket, executorSocket]) {
      expect(await s.emitWithAck('joinWorkflow', { workflowId: wfA.id })).toEqual({ ok: true });
    }
    const nextNode = (s: Socket) =>
      new Promise<NodeFinishedEvent>((resolve) => {
        const on = (e: NodeFinishedEvent) => {
          if (e.nodeId !== 's') return;
          s.off('nodeFinished', on);
          resolve(e);
        };
        s.on('nodeFinished', on);
      });
    const [forEditor, forExecutor] = [nextNode(editorSocket), nextNode(executorSocket)];
    await testRun(editor, wfA);
    expect((await forEditor).data.output.main?.[0]?.json.cpf).toBe('123.456.789-00');
    const redacted = await forExecutor;
    expect(redacted).toMatchObject({
      dataRedacted: true,
      data: { input: {}, output: {} },
      status: 'success',
    });

    // O webhook de teste também: o payload só vai para quem pode ver dados.
    const hookDef: WorkflowDefinition = {
      nodes: [
        {
          id: 'w',
          type: 'trigger.webhook',
          name: 'Webhook',
          params: { httpMethod: 'POST', path: 'evento-teste', responseMode: 'onReceived' },
          position: [0, 0],
        },
      ],
      edges: [],
      settings: {},
    };
    const received = (s: Socket) =>
      new Promise<TestWebhookReceivedEvent>((resolve) => s.once('testWebhookReceived', resolve));
    const [hookEditor, hookExecutor] = [received(editorSocket), received(executorSocket)];
    await editor.call('POST', `/workflows/${wfA.id}/listen-test-webhook`, { definition: hookDef });
    await ctx.app.inject({
      method: 'POST',
      url: '/webhook-test/evento-teste',
      payload: '{"nome":"Ana"}',
      headers: { 'content-type': 'application/json' },
    });
    expect((await hookEditor).payload?.json.body).toEqual({ nome: 'Ana' });
    const hidden = await hookExecutor;
    expect(hidden).toMatchObject({ workflowId: wfA.id, nodeId: 'w' });
    expect(hidden.payload).toBeUndefined();
  });
});
