import type {
  ExecutionSteps,
  NodeFinishedEvent,
  ProjectSummary,
  WorkflowDefinition,
} from '@olly/shared-types';
import { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';
import { runningStepsKey } from './running-steps.js';

let ctx: TestContext;
let url: string;
let redis: Redis;
let editor: TestUser, viewer: TestUser, outsider: TestUser;
let project: ProjectSummary;
const sockets: Socket[] = [];

/** Início → Esperar (em memória, `seconds`) → Fim. */
const slow = (seconds: number): WorkflowDefinition => ({
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'w',
      type: 'flow.wait',
      name: 'Esperar',
      params: { resume: 'timeInterval', amount: seconds, unit: 'seconds' },
      position: [200, 0],
    },
    {
      id: 'fim',
      type: 'data.set',
      name: 'Fim',
      params: { fields: [{ name: 'segredo', type: 'string', value: 'dado-grande' }] },
      position: [400, 0],
    },
  ],
  edges: [
    { id: 'a', from: 'm', fromPort: 'main', to: 'w', toPort: 'main' },
    { id: 'b', from: 'w', fromPort: 'main', to: 'fim', toPort: 'main' },
  ],
  settings: {},
});

const steps = async (user: TestUser, executionId: string, query = '') => {
  const res = await user.call('GET', `/executions/${executionId}/steps${query}`);
  return { statusCode: res.statusCode, body: res.json<ExecutionSteps>() };
};

/** Espera até o passo em andamento aparecer na rota. */
async function untilRunning(user: TestUser, executionId: string, nodeId: string) {
  let last: ExecutionSteps | undefined;
  await expect
    .poll(
      async () => {
        last = (await steps(user, executionId)).body;
        return last.running.some((r) => r.nodeId === nodeId);
      },
      { timeout: 15_000, interval: 50 },
    )
    .toBe(true);
  return last as ExecutionSteps;
}

function connect(token: string): Promise<Socket> {
  const socket = io(`${url}/executions`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('connect_error', reject);
  });
}

beforeAll(async () => {
  ctx = await startTestContext();
  url = await ctx.listen();
  redis = new Redis(ctx.redis.getConnectionUrl());
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@steps.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@steps.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@steps.local' });
  outsider = await loginAs(ctx, { sub: 'outsider', email: 'outsider@steps.local' });
  project = (await admin.call('POST', '/projects', { name: 'Ao vivo' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  await admin.call('PUT', `/projects/${project.id}/members/${viewer.id}`, { role: 'viewer' });
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  redis.disconnect();
  await ctx.close();
});

describe('spec 029 — GET /executions/:id/steps (acompanhamento ao vivo)', () => {
  it('FR-005: o passo em andamento aparece durante o nó lento e o hash some no fim (worker)', async () => {
    const wf = await createWorkflow(editor, project.id, slow(2));
    const executionId = await startTestRun(editor, wf);
    const live = await untilRunning(editor, executionId, 'w');
    expect(live.status).toBe('running');
    expect(live.running).toEqual([
      {
        nodeId: 'w',
        nodeName: 'Esperar',
        nodeType: 'flow.wait',
        runIndex: 0,
        startedAt: expect.any(String) as string,
      },
    ]);
    // FR-005/FR-010: os concluídos antes de abrir e o progresso (Início e Esperar já rodaram).
    expect(live.steps.map((s) => s.nodeId)).toEqual(['m']);
    expect(live.nodeCount).toBe(3);
    expect(live.nodes).toEqual([
      { id: 'm', name: 'Início', type: 'trigger.manual' },
      { id: 'w', name: 'Esperar', type: 'flow.wait' },
      { id: 'fim', name: 'Fim', type: 'data.set' },
    ]);
    expect([...live.executedNodeIds].sort()).toEqual(['m', 'w']);
    expect(await redis.hkeys(runningStepsKey(executionId))).toEqual(['w#0']);

    await waitForStatus(editor, executionId);
    const done = (await steps(editor, executionId)).body;
    expect(done.status).toBe('success');
    expect(done.running).toEqual([]);
    expect(done.steps.map((s) => s.nodeId)).toEqual(['m', 'w', 'fim']);
    await expect.poll(() => redis.exists(runningStepsKey(executionId))).toBe(0);
  });

  it('FR-005: o mesmo vale para a execução em processo na API (ExecutionEventsService)', async () => {
    const previous = ctx.config.queue.testRunMode;
    ctx.config.queue.testRunMode = 'inprocess';
    try {
      const wf = await createWorkflow(editor, project.id, slow(2));
      const executionId = await startTestRun(editor, wf);
      const live = await untilRunning(editor, executionId, 'w');
      expect(live.running.map((r) => `${r.nodeId}#${String(r.runIndex)}`)).toEqual(['w#0']);
      await waitForStatus(editor, executionId);
      await expect.poll(() => redis.exists(runningStepsKey(executionId))).toBe(0);
    } finally {
      ctx.config.queue.testRunMode = previous;
    }
  });

  it('FR-002/FR-003/FR-013: cabeçalho e passos só com metadados, sem entrada nem saída', async () => {
    const wf = await createWorkflow(editor, project.id, slow(0));
    const executionId = await startTestRun(editor, wf);
    await waitForStatus(editor, executionId);
    const { statusCode, body } = await steps(editor, executionId);
    expect(statusCode).toBe(200);
    expect(body).toMatchObject({
      id: executionId,
      workflowId: wf.id,
      projectId: project.id,
      mode: 'test',
      triggerType: 'manual',
      status: 'success',
      error: null,
      resumeAt: null,
      total: 3,
      running: [],
      subExecutions: [],
    });
    expect(body.finishedAt).not.toBeNull();
    expect(body).not.toHaveProperty('definition');
    expect(body.steps[2]).toEqual({
      nodeId: 'fim',
      nodeName: 'Fim',
      nodeType: 'data.set',
      runIndex: 0,
      status: 'success',
      startedAt: expect.any(String) as string,
      finishedAt: expect.any(String) as string,
      itemsIn: 1,
      itemsOut: 1,
      error: null,
    });
    // FR-013: nenhum dado do nó na resposta, nem para quem tem `execution:readData`.
    expect(JSON.stringify(body)).not.toContain('dado-grande');
  });

  it('FR-016: com limit, os últimos passos em ordem de início e o total de todos', async () => {
    const wf = await createWorkflow(editor, project.id, slow(0));
    const executionId = await startTestRun(editor, wf);
    await waitForStatus(editor, executionId);
    const { body } = await steps(editor, executionId, '?limit=2');
    expect(body.total).toBe(3);
    expect(body.steps.map((s) => s.nodeId)).toEqual(['w', 'fim']);
    expect((await steps(editor, executionId, '?limit=0')).statusCode).toBe(400);
    expect((await steps(editor, executionId, '?limit=10001')).statusCode).toBe(400);
  });

  it('FR-006: o passo com erro traz a mensagem, e o erro geral vem no topo', async () => {
    const failing: WorkflowDefinition = {
      nodes: [
        { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
        {
          id: 'c',
          type: 'code.javascript',
          name: 'Falha',
          params: { mode: 'runOnceForAllItems', jsCode: "throw new Error('quebrou aqui');" },
          position: [200, 0],
        },
      ],
      edges: [{ id: 'a', from: 'm', fromPort: 'main', to: 'c', toPort: 'main' }],
      settings: {},
    };
    const wf = await createWorkflow(editor, project.id, failing);
    const executionId = await startTestRun(editor, wf);
    await waitForStatus(editor, executionId);
    const { body } = await steps(editor, executionId);
    expect(body.status).toBe('error');
    expect(body.error?.message).toContain('quebrou aqui');
    const step = body.steps.find((s) => s.nodeId === 'c');
    expect(step?.status).toBe('error');
    expect(step?.error?.message).toContain('quebrou aqui');
  });

  it('FR-007: na espera longa, status waiting, o passo aguardando e o horário de retomada', async () => {
    const def = slow(2);
    const wait = def.nodes[1];
    if (wait) wait.params = { resume: 'timeInterval', amount: 2, unit: 'minutes' };
    const wf = await createWorkflow(editor, project.id, def);
    const before = Date.now();
    const executionId = await startTestRun(editor, wf);
    await waitForStatus(editor, executionId, (s) => s === 'waiting');
    const { body } = await steps(editor, executionId);
    expect(body.status).toBe('waiting');
    expect(body.running).toEqual([]);
    expect(body.steps.find((s) => s.nodeId === 'w')?.status).toBe('waiting');
    const resumeAt = Date.parse(body.resumeAt ?? '');
    expect(resumeAt).toBeGreaterThanOrEqual(before + 110_000);
    expect(resumeAt).toBeLessThanOrEqual(Date.now() + 125_000);
    await editor.call('POST', `/executions/${executionId}/cancel`);
  });

  it('FR-011: as subexecuções vêm com o status e o nó que as criou', async () => {
    const child = await createWorkflow(editor, project.id, {
      nodes: [
        { id: 't', type: 'trigger.executeWorkflow', name: 'Chamado', params: {}, position: [0, 0] },
      ],
      edges: [],
      settings: {},
    });
    expect(
      (await editor.call('POST', `/workflows/${child.id}/publish`, { message: 'Filho' }))
        .statusCode,
    ).toBe(200);
    const parent = await createWorkflow(editor, project.id, {
      nodes: [
        { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
        {
          id: 'x',
          type: 'flow.executeWorkflow',
          name: 'Chama',
          params: { workflowId: child.id, mode: 'once' },
          position: [200, 0],
        },
      ],
      edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'x', toPort: 'main' }],
      settings: {},
    });
    const executionId = await startTestRun(editor, parent);
    await waitForStatus(editor, executionId);
    const { body } = await steps(editor, executionId);
    expect(body.subExecutions).toHaveLength(1);
    expect(body.subExecutions[0]).toMatchObject({
      workflowId: child.id,
      nodeId: 'x',
      status: 'success',
    });
  });

  it('FR-012/SC-004: sem execution:read, 404; o viewer acompanha sem dados', async () => {
    const wf = await createWorkflow(editor, project.id, slow(0));
    const executionId = await startTestRun(editor, wf);
    await waitForStatus(editor, executionId);
    expect((await steps(outsider, executionId)).statusCode).toBe(404);
    expect((await steps(editor, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    const { statusCode, body } = await steps(viewer, executionId);
    expect(statusCode).toBe(200);
    expect(body.steps).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain('dado-grande');
  });
});

describe('spec 029 — WebSocket: join com metadataOnly e leave', () => {
  it('FR-013: com metadataOnly, quem tem execution:readData recebe o nodeFinished sem dados', async () => {
    const wf = await createWorkflow(editor, project.id, slow(1));
    const full = await connect(editor.token);
    const meta = await connect(editor.token);
    const received = { full: [] as NodeFinishedEvent[], meta: [] as NodeFinishedEvent[] };
    full.on('nodeFinished', (e: NodeFinishedEvent) => received.full.push(e));
    meta.on('nodeFinished', (e: NodeFinishedEvent) => received.meta.push(e));
    const executionId = await startTestRun(editor, wf);
    expect(await full.emitWithAck('join', { executionId })).toEqual({ ok: true });
    expect(await meta.emitWithAck('join', { executionId, metadataOnly: true })).toEqual({
      ok: true,
    });
    await waitForStatus(editor, executionId);
    await expect.poll(() => received.meta.some((e) => e.nodeId === 'fim')).toBe(true);
    await expect.poll(() => received.full.some((e) => e.nodeId === 'fim')).toBe(true);
    const metaFim = received.meta.find((e) => e.nodeId === 'fim');
    expect(metaFim).toMatchObject({
      status: 'success',
      itemsIn: 1,
      itemsOut: 1,
      dataRedacted: true,
    });
    expect(metaFim?.data).toEqual({ input: {}, output: {} });
    expect(JSON.stringify(received.meta)).not.toContain('dado-grande');
    expect(JSON.stringify(received.full)).toContain('dado-grande');
  });

  it('FR-013: na sala do workflow com dados e na da execução sem dados, o evento chega uma vez, completo', async () => {
    const wf = await createWorkflow(editor, project.id, slow(1));
    const socket = await connect(editor.token);
    const received: NodeFinishedEvent[] = [];
    socket.on('nodeFinished', (e: NodeFinishedEvent) => received.push(e));
    expect(await socket.emitWithAck('joinWorkflow', { workflowId: wf.id })).toEqual({ ok: true });
    const executionId = await startTestRun(editor, wf);
    expect(await socket.emitWithAck('join', { executionId, metadataOnly: true })).toEqual({
      ok: true,
    });
    await waitForStatus(editor, executionId);
    await expect.poll(() => received.some((e) => e.nodeId === 'fim')).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    const fim = received.filter((e) => e.nodeId === 'fim');
    expect(fim).toHaveLength(1);
    expect(fim[0]?.dataRedacted).toBeUndefined();
    expect(JSON.stringify(fim[0])).toContain('dado-grande');
  });

  it('FR-004: leave para de receber os eventos da execução', async () => {
    const wf = await createWorkflow(editor, project.id, slow(2));
    const socket = await connect(editor.token);
    const events: string[] = [];
    socket.onAny((event: string, payload: { nodeId?: string }) => {
      events.push(payload.nodeId ? `${event}:${payload.nodeId}` : event);
    });
    const executionId = await startTestRun(editor, wf);
    expect(await socket.emitWithAck('join', { executionId, metadataOnly: true })).toEqual({
      ok: true,
    });
    await untilRunning(editor, executionId, 'w');
    expect(await socket.emitWithAck('leave', { executionId })).toEqual({ ok: true });
    const atLeave = events.length;
    await waitForStatus(editor, executionId);
    await new Promise((r) => setTimeout(r, 300));
    expect(events.slice(atLeave)).toEqual([]);
    expect(events).not.toContain('nodeFinished:fim');
  });
});
