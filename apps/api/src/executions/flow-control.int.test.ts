import type {
  ExecutionList,
  NodeFinishedEvent,
  ProjectSummary,
  WorkflowDefinition,
  WorkflowNode,
} from '@olly/shared-types';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkflow,
  edge,
  manualNode,
  startTestRun,
  waitForStatus,
} from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let admin: TestUser, editor: TestUser;
let project: ProjectSummary, other: ProjectSummary;

const set = (
  id: string,
  name: string,
  fields: [string, string][],
  extra: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id,
  type: 'data.set',
  name,
  params: { fields: fields.map(([n, value]) => ({ name: n, type: 'string', value })) },
  position: [0, 0],
  ...extra,
});
const errorTrigger: WorkflowNode = {
  id: 'g',
  type: 'trigger.error',
  name: 'Gatilho de erro',
  params: {},
  position: [0, 0],
};
const errorFlow = (alertFields: [string, string][]): WorkflowDefinition => ({
  nodes: [errorTrigger, set('a', 'Alerta', alertFields)],
  edges: [edge('g', 'a')],
  settings: {},
});
const failingHook = (path: string, errorWorkflowId?: string): WorkflowDefinition => ({
  nodes: [
    {
      id: 'w',
      type: 'trigger.webhook',
      name: 'Webhook',
      params: { httpMethod: 'POST', path, responseMode: 'onReceived' },
      position: [0, 0],
    },
    set('q', 'Quebra', [['x', '={{ $json.nao.existe.campo }}']]),
  ],
  edges: [edge('w', 'q')],
  settings: errorWorkflowId ? { errorWorkflowId } : {},
});

const executionsOf = async (workflowId: string) =>
  (await editor.call('GET', `/executions?workflowId=${workflowId}`)).json<ExecutionList>().items;

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('condição não atingida');
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function callHook(path: string) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/webhook/${path}`,
    payload: '{"pedido":1}',
    headers: { 'content-type': 'application/json' },
  });
  expect(res.statusCode).toBe(202);
  return res.json<{ executionId: string }>().executionId;
}

beforeAll(async () => {
  ctx = await startTestContext();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'Fluxo' })).json<ProjectSummary>();
  other = (await admin.call('POST', '/projects', { name: 'Outro' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
});
afterAll(async () => {
  await ctx.close();
});

describe('spec 007 — FR-014/FR-015/SC-006: workflow de erro', () => {
  it('SC-006: falha em produção aciona o workflow de erro com o payload do Error Trigger', async () => {
    const handler = await createWorkflow(
      editor,
      project.id,
      errorFlow([
        ['texto', '=Falhou {{ $json.workflow.name }} em {{ $json.execution.lastNodeExecuted }}'],
        ['url', '={{ $json.execution.url }}'],
        ['modo', '={{ $json.execution.mode }}'],
        ['erro', '={{ $json.execution.error.message }}'],
      ]),
    );
    const main = await createWorkflow(editor, project.id, failingHook('pedido-falha', handler.id));
    await editor.call('POST', `/workflows/${main.id}/publish`, { message: 'Publicação de teste' });
    const failedId = await callHook('pedido-falha');
    expect((await waitForStatus(editor, failedId)).status).toBe('error');

    const run = await until(async () => (await executionsOf(handler.id))[0]);
    expect(run).toMatchObject({ mode: 'production', triggerType: 'error' });
    const detail = await waitForStatus(editor, run.id);
    expect(detail.status).toBe('success');
    const alert = detail.nodes.find((n) => n.nodeId === 'a')?.output?.main?.[0]?.json;
    expect(alert).toMatchObject({
      texto: `Falhou ${main.name} em Quebra`,
      url: `http://localhost:5173/executions/${failedId}`,
      modo: 'webhook',
    });
    expect(String(alert?.erro)).toContain('Cannot read properties of undefined');
    const trigger = detail.nodes.find((n) => n.nodeId === 'g')?.output?.main?.[0]?.json;
    expect(trigger).toMatchObject({
      execution: { id: failedId, lastNodeExecuted: 'Quebra', mode: 'webhook' },
      workflow: { id: main.id, name: main.name },
    });
  });

  it('FR-015: execução de workflow de erro que falha não aciona outro workflow de erro', async () => {
    const last = await createWorkflow(editor, project.id, errorFlow([['ok', 'sim']]));
    const failingHandler = await createWorkflow(editor, project.id, {
      nodes: [errorTrigger, set('q', 'Quebra também', [['x', '={{ $json.nada.aqui.x }}']])],
      edges: [edge('g', 'q')],
      settings: { errorWorkflowId: last.id },
    });
    const main = await createWorkflow(editor, project.id, failingHook('cadeia', failingHandler.id));
    await editor.call('POST', `/workflows/${main.id}/publish`, { message: 'Publicação de teste' });
    await callHook('cadeia');
    const handlerRun = await until(async () => (await executionsOf(failingHandler.id))[0]);
    expect((await waitForStatus(editor, handlerRun.id)).status).toBe('error');
    await new Promise((r) => setTimeout(r, 1000));
    expect(await executionsOf(last.id)).toEqual([]);
  });

  it('FR-014: falha em execução de teste não aciona o workflow de erro', async () => {
    const handler = await createWorkflow(editor, project.id, errorFlow([['ok', 'sim']]));
    const wf = await createWorkflow(editor, project.id, {
      nodes: [manualNode(), set('q', 'Quebra', [['x', '={{ $json.a.b.c }}']])],
      edges: [edge('m', 'q')],
      settings: { errorWorkflowId: handler.id },
    });
    expect((await waitForStatus(editor, await startTestRun(editor, wf))).status).toBe('error');
    await new Promise((r) => setTimeout(r, 800));
    expect(await executionsOf(handler.id)).toEqual([]);
  });

  it('FR-015: o workflow de erro é validado ao salvar', async () => {
    const plain = await createWorkflow(editor, project.id, {
      nodes: [manualNode()],
      edges: [],
      settings: {},
    });
    const foreign = (
      await admin.call('POST', `/projects/${other.id}/workflows`, {
        name: 'Erro de outro projeto',
        definition: errorFlow([['ok', 'sim']]),
      })
    ).json<{ id: string }>();
    const save = (errorWorkflowId: string) =>
      editor.call('PUT', `/workflows/${plain.id}`, {
        definition: { ...plain.definition, settings: { errorWorkflowId } },
        baseVersion: plain.version,
      });
    const message = async (r: ReturnType<typeof save>) =>
      (await r).json<{ error: { message: string } }>().error.message;
    expect(await message(save(plain.id))).toMatch(/próprio/);
    const withoutTrigger = await createWorkflow(editor, project.id, plain.definition);
    expect(await message(save(withoutTrigger.id))).toMatch(/Gatilho de erro/);
    expect((await save(foreign.id)).statusCode).toBe(422);
    const handler = await createWorkflow(editor, project.id, errorFlow([['ok', 'sim']]));
    expect((await save(handler.id)).statusCode).toBe(200);
    const row = await ctx.database.db
      .selectFrom('workflows')
      .select('error_workflow_id')
      .where('id', '=', plain.id)
      .executeTakeFirstOrThrow();
    expect(row.error_workflow_id).toBe(handler.id);
  });
});

describe('spec 007 — FR-009/FR-008: laços pela API', () => {
  it('FR-009: cada iteração é gravada com runIndex e anunciada em tempo real', async () => {
    const wf = await createWorkflow(editor, project.id, {
      nodes: [
        manualNode(),
        {
          id: 'w',
          type: 'logic.while',
          name: 'Enquanto',
          params: { condition: '={{ $loop.index < 3 }}', accumulate: 'appendBodyOutput' },
          position: [0, 0],
        },
        set('b', 'Corpo', [['volta', '={{ $loop.index }}']]),
      ],
      edges: [
        edge('m', 'w'),
        { id: 'loop', from: 'w', fromPort: 'loop', to: 'b', toPort: 'main' },
        { id: 'back', from: 'b', fromPort: 'main', to: 'w', toPort: 'continue' },
      ],
      settings: {},
    });
    const url = await ctx.listen();
    const socket: Socket = io(`${url}/executions`, {
      auth: { token: editor.token },
      transports: ['websocket'],
      reconnection: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      await socket.emitWithAck('joinWorkflow', { workflowId: wf.id });
      const seen: number[] = [];
      socket.on('nodeFinished', (e: NodeFinishedEvent) => {
        if (e.nodeId === 'b') seen.push(e.runIndex);
      });
      const detail = await waitForStatus(editor, await startTestRun(editor, wf));
      expect(detail.status).toBe('success');
      const body = detail.nodes.filter((n) => n.nodeId === 'b');
      expect(body.map((n) => [n.runIndex, n.output?.main?.[0]?.json.volta])).toEqual([
        [0, '0'],
        [1, '1'],
        [2, '2'],
      ]);
      expect(detail.nodes.filter((n) => n.nodeId === 'w').map((n) => n.runIndex)).toEqual([
        0, 1, 2, 3,
      ]);
      await until(() => Promise.resolve(seen.length === 3 ? true : undefined), 3000);
      expect(seen).toEqual([0, 1, 2]);
    } finally {
      socket.disconnect();
    }
  });

  it('SC-005: ciclo inválido é recusado ao salvar, com os nós envolvidos', async () => {
    const res = await editor.call('POST', `/projects/${project.id}/workflows`, {
      name: 'Ciclo',
      definition: {
        nodes: [manualNode(), set('a', 'A', []), set('b', 'B', [])],
        edges: [edge('m', 'a'), edge('a', 'b'), edge('b', 'a')],
        settings: {},
      },
    });
    expect(res.statusCode).toBe(422);
    expect(
      res.json<{ error: { issues: { code: string; nodeIds: string[] }[] } }>().error.issues,
    ).toContainEqual(expect.objectContaining({ code: 'INVALID_CYCLE', nodeIds: ['a', 'b'] }));
  });
});
