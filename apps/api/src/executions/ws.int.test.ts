import type {
  ExecutionFinishedEvent,
  NodeFinishedEvent,
  ProjectSummary,
  TestRunResponse,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';
import type { JoinAck } from './executions.gateway.js';

let ctx: TestContext;
let url: string;
let editor: TestUser, viewer: TestUser, outsider: TestUser;
let workflow: WorkflowDetail;
const sockets: Socket[] = [];

// Nó lento (≈ 4 × 60 ms) para dar tempo de entrar na sala antes do fim.
const definition: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'lento',
      type: 'data.set',
      name: 'Lento',
      params: {
        fields: [
          {
            name: 'x',
            type: 'number',
            value:
              '={{ (() => { const t = Date.now(); while (Date.now() - t < 60) {} return 1; })() }}',
          },
        ],
      },
      position: [200, 0],
    },
    { id: 'fim', type: 'data.set', name: 'Fim', params: { fields: [] }, position: [400, 0] },
  ],
  edges: [
    { id: 'a', from: 'm', fromPort: 'main', to: 'lento', toPort: 'main' },
    { id: 'b', from: 'lento', fromPort: 'main', to: 'fim', toPort: 'main' },
  ],
  settings: {},
  pinData: { m: [{ json: {} }, { json: {} }, { json: {} }, { json: {} }] },
};

function connect(token: string | undefined): Promise<Socket> {
  const socket = io(`${url}/executions`, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      reject(error);
    });
  });
}

const join = (socket: Socket, executionId: unknown) =>
  socket.emitWithAck('join', { executionId }) as Promise<JoinAck>;

beforeAll(async () => {
  ctx = await startTestContext();
  url = await ctx.listen();
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@t.local' });
  outsider = await loginAs(ctx, { sub: 'outsider', email: 'outsider@t.local' });
  const project = (await admin.call('POST', '/projects', { name: 'P' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  await admin.call('PUT', `/projects/${project.id}/members/${viewer.id}`, { role: 'viewer' });
  workflow = (
    await editor.call('POST', `/projects/${project.id}/workflows`, { name: 'WS' })
  ).json<WorkflowDetail>();
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await ctx.close();
});

describe('spec 003 — FR-012/FR-013: eventos em tempo real com autorização', () => {
  it('FR-013: conexão sem token ou com token inválido é recusada', async () => {
    await expect(connect(undefined)).rejects.toThrow('unauthenticated');
    await expect(connect('token.invalido.x')).rejects.toThrow('unauthenticated');
  });

  it('FR-012: quem entra na sala recebe nodeFinished e executionFinished', async () => {
    const socket = await connect(editor.token);
    const nodes: NodeFinishedEvent[] = [];
    socket.on('nodeFinished', (e: NodeFinishedEvent) => nodes.push(e));
    const finished = new Promise<ExecutionFinishedEvent>((resolve) =>
      socket.once('executionFinished', resolve),
    );

    const { executionId } = (
      await editor.call('POST', `/workflows/${workflow.id}/test-run`, { definition })
    ).json<TestRunResponse>();
    expect(await join(socket, executionId)).toEqual({ ok: true });

    const end = await finished;
    expect(end).toMatchObject({ executionId, status: 'success', error: null });
    const fim = nodes.find((n) => n.nodeId === 'fim');
    expect(fim).toMatchObject({
      executionId,
      status: 'success',
      itemsIn: 4,
      itemsOut: 4,
      pinned: false,
    });
    expect(fim?.durationMs).toBeGreaterThanOrEqual(0);
    expect(fim?.data.output.main).toHaveLength(4);
  });

  it('FR-013: membro com execution:read entra; de fora e inexistente recebem not_found', async () => {
    const { executionId } = (
      await editor.call('POST', `/workflows/${workflow.id}/test-run`, { definition })
    ).json<TestRunResponse>();
    expect(await join(await connect(viewer.token), executionId)).toEqual({ ok: true });
    expect(await join(await connect(outsider.token), executionId)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await join(await connect(editor.token), '00000000-0000-4000-8000-000000000000')).toEqual(
      {
        ok: false,
        error: 'not_found',
      },
    );
    expect(await join(await connect(editor.token), 'nao-e-uuid')).toEqual({
      ok: false,
      error: 'invalid',
    });
  });

  it('FR-012: na sala do workflow recebe todos os eventos, desde o início da execução', async () => {
    const socket = await connect(editor.token);
    expect(await socket.emitWithAck('joinWorkflow', { workflowId: workflow.id })).toEqual({
      ok: true,
    });
    // A sala recebe todas as execuções do workflow; filtra pela que este teste dispara.
    const events: { event: string; executionId: string; nodeId?: string }[] = [];
    socket.onAny((event: string, payload: { executionId: string; nodeId?: string }) => {
      events.push({
        event,
        executionId: payload.executionId,
        ...(payload.nodeId && { nodeId: payload.nodeId }),
      });
    });
    const res = await editor.call('POST', `/workflows/${workflow.id}/test-run`, { definition });
    const { executionId } = res.json<TestRunResponse>();
    await expect
      .poll(
        () => events.some((e) => e.event === 'executionFinished' && e.executionId === executionId),
        { timeout: 10_000 },
      )
      .toBe(true);
    const mine = events
      .filter((e) => e.executionId === executionId)
      .map((e) => (e.nodeId ? `${e.event}:${e.nodeId}` : e.event));
    expect(mine).toEqual([
      'executionStarted',
      'nodeStarted:m',
      'nodeFinished:m',
      'nodeStarted:lento',
      'nodeFinished:lento',
      'nodeStarted:fim',
      'nodeFinished:fim',
      'executionFinished',
    ]);
  });

  it('FR-013: sala do workflow exige execution:read no projeto', async () => {
    expect(
      await (await connect(viewer.token)).emitWithAck('joinWorkflow', { workflowId: workflow.id }),
    ).toEqual({ ok: true });
    expect(
      await (
        await connect(outsider.token)
      ).emitWithAck('joinWorkflow', { workflowId: workflow.id }),
    ).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('FR-013: quem não entrou na sala não recebe eventos', async () => {
    const intruder = await connect(outsider.token);
    const received: unknown[] = [];
    intruder.onAny((event: string) => received.push(event));
    const watcher = await connect(editor.token);
    const finished = new Promise((resolve) => watcher.once('executionFinished', resolve));
    const { executionId } = (
      await editor.call('POST', `/workflows/${workflow.id}/test-run`, { definition })
    ).json<TestRunResponse>();
    await join(watcher, executionId);
    await join(intruder, executionId);
    await finished;
    expect(received).toEqual([]);
  });
});
