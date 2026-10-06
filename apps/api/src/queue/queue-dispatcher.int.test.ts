import type {
  ExecutionFinishedEvent,
  NodeFinishedEvent,
  ProjectSummary,
  WorkflowDefinition,
} from '@olly/shared-types';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import {
  createWorkflow,
  edge,
  manualNode,
  startTestRun,
  waitForStatus,
} from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';
import { EXECUTIONS_QUEUE } from './constants.js';

let ctx: TestContext;
let editor: TestUser;
let project: ProjectSummary;
let redis: Redis;
let queue: Queue;

const webhook = (path: string, responseMode: string): WorkflowDefinition => ({
  nodes: [
    {
      id: 'w',
      type: 'trigger.webhook',
      name: 'Webhook',
      params: { httpMethod: 'POST', path, responseMode },
      position: [0, 0],
    },
    {
      id: 's',
      type: 'data.set',
      name: 'Montar',
      params: { fields: [{ name: 'ola', type: 'string', value: '={{ $json.body.nome }}' }] },
      position: [200, 0],
    },
  ],
  edges: [edge('w', 's')],
  settings: {},
});

async function publish(definition: WorkflowDefinition): Promise<void> {
  const wf = await createWorkflow(editor, project.id, definition);
  const res = await editor.call('POST', `/workflows/${wf.id}/publish`, {
    message: 'Publicação de teste',
  });
  expect(res.statusCode).toBe(200);
}

const callHook = (path: string, body: object) =>
  ctx.app.inject({
    method: 'POST',
    url: `/webhook/${path}`,
    payload: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

beforeAll(async () => {
  // Sem worker no início: o teste verifica o que fica na fila antes de alguém consumir.
  ctx = await startTestContext({}, { worker: false });
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'Fila' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  redis = new Redis(ctx.config.redisUrl, { maxRetriesPerRequest: null });
  queue = new Queue(EXECUTIONS_QUEUE, { connection: redis });
});
afterAll(async () => {
  await queue.close();
  redis.disconnect();
  await ctx.close();
});

describe('spec 006 — FR-001: execuções de produção vão para a fila', () => {
  it('FR-001: o job carrega só o id; o payload fica fora da fila; um worker independente executa', async () => {
    await publish(webhook('fila', 'onReceived'));
    const res = await callHook('fila', { nome: 'Ana', cpf: '123.456.789-00' });
    expect(res.statusCode).toBe(202);
    const { executionId } = res.json<{ executionId: string }>();

    // Sem worker, a execução espera na fila.
    await new Promise((r) => setTimeout(r, 300));
    expect((await waitForStatus(editor, executionId, () => true)).status).toBe('queued');
    const job = await queue.getJob(executionId);
    expect(job?.data).toEqual({ executionId });
    expect(JSON.stringify(job?.data)).not.toContain('Ana');
    const payload = await ctx.database.db
      .selectFrom('execution_payloads')
      .select(['data', 'data_ref'])
      .where('execution_id', '=', executionId)
      .executeTakeFirstOrThrow();
    expect(payload.data_ref).toBeNull();
    expect(payload.data).toMatchObject({
      startNodeId: 'w',
      triggerItems: [{ json: { body: { nome: 'Ana', cpf: '123.456.789-00' } } }],
    });

    // O worker (outro contexto, sem HTTP) consome e executa.
    const worker = await ctx.startWorker();
    const detail = await waitForStatus(editor, executionId);
    expect(detail.status).toBe('success');
    expect(detail.nodes.find((n) => n.nodeId === 's')?.output?.main?.[0]?.json).toEqual({
      ola: 'Ana',
    });
    expect(worker.stats().processed).toBeGreaterThanOrEqual(1);
  });
});

describe('spec 006 — FR-002: resposta síncrona do webhook a partir do worker', () => {
  it('FR-002: modo lastNode responde com o último nó executado pelo worker', async () => {
    await publish(webhook('sincrono', 'lastNode'));
    const res = await callHook('sincrono', { nome: 'Bruno' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ola: 'Bruno' });
  });

  it('FR-002: modo responseNode devolve a resposta do nó "Responder ao webhook"', async () => {
    const def = webhook('responder', 'responseNode');
    def.nodes.push({
      id: 'r',
      type: 'http.respondToWebhook',
      name: 'Responder',
      params: { respondWith: 'firstItemJson', responseCode: 201 },
      position: [400, 0],
    });
    def.edges.push(edge('s', 'r'));
    await publish(def);
    const res = await callHook('responder', { nome: 'Caio' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ola: 'Caio' });
  });
});

describe('spec 006 — FR-003: eventos com várias instâncias de API', () => {
  it('FR-003: com duas APIs, eventos e rotas de webhook valem para as duas', async () => {
    const other = await createApp(ctx.config);
    const sockets: Socket[] = [];
    try {
      await other.listen(0, '127.0.0.1');
      const url = (await other.getUrl()).replace('[::1]', '127.0.0.1');
      const socket = io(`${url}/executions`, {
        auth: { token: editor.token },
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      const wf = await createWorkflow(editor, project.id, {
        nodes: [
          manualNode(),
          {
            id: 's',
            type: 'data.set',
            name: 'Dado',
            params: { fields: [{ name: 'x', type: 'number', value: '7' }] },
            position: [200, 0],
          },
        ],
        edges: [edge('m', 's')],
        settings: {},
      });
      expect(await socket.emitWithAck('joinWorkflow', { workflowId: wf.id })).toEqual({ ok: true });
      const nodeEvent = new Promise<NodeFinishedEvent>((resolve) => {
        socket.on('nodeFinished', (e: NodeFinishedEvent) => {
          if (e.nodeId === 's') resolve(e);
        });
      });
      const finished = new Promise<ExecutionFinishedEvent>((resolve) => {
        socket.once('executionFinished', resolve);
      });
      // Disparada na API A (ctx.app), executada pelo worker, vista na API B.
      const executionId = await startTestRun(editor, wf);
      expect((await nodeEvent).data.output.main?.[0]?.json).toEqual({ x: 7 });
      expect(await finished).toMatchObject({ executionId, status: 'success' });

      // Publicar na API A atualiza as rotas de webhook da API B (cache avisado pelo Redis).
      const viaB = () =>
        other.inject({
          method: 'POST',
          url: '/webhook/outra-instancia',
          payload: '{"nome":"Duda"}',
          headers: { 'content-type': 'application/json' },
        });
      expect((await viaB()).statusCode).toBe(404);
      await publish(webhook('outra-instancia', 'lastNode'));
      await new Promise((r) => setTimeout(r, 200));
      const res = await viaB();
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ola: 'Duda' });
    } finally {
      for (const s of sockets) s.disconnect();
      await other.close();
    }
  });
});
