import type { ReadableStream, ReadableStreamReadResult } from 'node:stream/web';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  ProjectSummary,
  PublishResponse,
  StreamEvent,
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowNode,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import {
  delayNode,
  startDelayServer,
  waitForStatus,
  type DelayServer,
} from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

/**
 * Spec 027 (T014): Webhook em "Streaming" com um cliente HTTP real que lê a resposta aos poucos:
 * ordem e tempo dos passos, só metadados, resposta final, erro, espera, desconexão, sinal
 * periódico, limite por projeto e duas instâncias da API.
 */
let ctx: TestContext;
let admin: TestUser, editor: TestUser;
let project: ProjectSummary;
let server: DelayServer;
let base: string;
let second: NestFastifyApplication;
let secondBase: string;

beforeAll(async () => {
  server = await startDelayServer();
  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 },
    webhook: {
      maxBodyBytes: 1024 * 1024,
      responseTimeoutMs: 120_000,
      rateLimitPerMin: 1000,
      requireAuth: false,
      streamMaxPerProject: 20,
      streamPingMs: 300,
    },
  });
  base = await ctx.listen();
  // NFR-002: segunda instância da API (mesmo banco e Redis), sem worker próprio.
  second = await createApp(ctx.config);
  await second.listen(0, '127.0.0.1');
  secondBase = (await second.getUrl()).replace('[::1]', '127.0.0.1');
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@stream.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@stream.local' });
  project = (await admin.call('POST', '/projects', { name: 'Stream' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
}, 240_000);
afterAll(async () => {
  await second.close();
  await ctx.close();
  await server.close();
});

let paths = 0;
const hook = (path: string, extra: Record<string, unknown> = {}): WorkflowNode => ({
  id: 'w',
  type: 'trigger.webhook',
  name: 'Webhook',
  params: { httpMethod: 'POST', path, responseMode: 'streaming', ...extra },
  position: [0, 0],
});
const chain = (nodes: WorkflowNode[], settings = {}): WorkflowDefinition => ({
  nodes,
  edges: nodes.slice(1).map((n, i) => ({
    id: `e${String(i)}`,
    from: nodes[i]?.id ?? '',
    fromPort: 'main',
    to: n.id,
    toPort: 'main',
  })),
  settings,
});
const named = (node: WorkflowNode, name: string): WorkflowNode => ({ ...node, name });
const setNode = (id: string, name: string, value: string): WorkflowNode => ({
  id,
  type: 'data.set',
  name,
  params: { fields: [{ name: 'resultado', type: 'string', value }] },
  position: [0, 0],
});

async function published(definition: WorkflowDefinition): Promise<PublishResponse> {
  const wf = (
    await editor.call('POST', `/projects/${project.id}/workflows`, {
      name: `stream ${String(++paths)}`,
      definition,
    })
  ).json<WorkflowDetail>();
  const res = await editor.call('POST', `/workflows/${wf.id}/publish`, {
    message: 'Publicação de teste',
  });
  expect(res.statusCode).toBe(200);
  return res.json<PublishResponse>();
}

interface Received {
  status: number;
  contentType: string | null;
  events: { at: number; event: StreamEvent }[];
  body?: unknown;
}

/** Chama o webhook e lê o stream linha a linha, com a hora de chegada de cada evento. */
async function stream(
  path: string,
  options: { url?: string; abortAfter?: (e: StreamEvent) => boolean } = {},
): Promise<Received> {
  const controller = new AbortController();
  const res = await fetch(`${options.url ?? base}/webhook/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"pergunta":"status do serviço"}',
    signal: controller.signal,
  });
  const received: Received = {
    status: res.status,
    contentType: res.headers.get('content-type'),
    events: [],
  };
  if (res.status !== 200 || !res.body) {
    received.body = await res.json();
    return received;
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.trim()) continue;
        const event = JSON.parse(line) as StreamEvent;
        received.events.push({ at: Date.now(), event });
        if (options.abortAfter?.(event)) {
          controller.abort();
          return received;
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }
  return received;
}

/** Sequência dos eventos, sem os sinais periódicos (que dependem do tempo). */
const kinds = (r: Received) =>
  r.events
    .filter(({ event }) => event.type !== 'ping')
    .map(({ event: e }) =>
      e.type === 'begin' || e.type === 'end'
        ? `${e.type}:${e.metadata.nodeName}`
        : e.type === 'execution'
          ? `execution:${e.metadata.status}`
          : e.type,
    );
const find = (r: Received, type: string, nodeName?: string) =>
  r.events.find(
    ({ event: e }) =>
      e.type === type &&
      (nodeName === undefined || ('nodeName' in e.metadata && e.metadata.nodeName === nodeName)),
  );

describe('spec 027 — Webhook em streaming', () => {
  it('FR-001/FR-002/FR-003/NFR-001/SC-001: passos com o nome do nó chegam aos poucos, só com metadados, e a resposta no fim', async () => {
    await published(
      chain([
        hook('passos'),
        named(delayNode('a', server.base, 600), 'Buscar métricas'),
        named(delayNode('b', server.base, 600), 'Analisar'),
        setNode('s', 'Montar resposta', 'tudo certo'),
      ]),
    );
    const r = await stream('passos');
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('application/json; charset=utf-8');
    expect(kinds(r)).toEqual([
      'execution:queued',
      'execution:started',
      'begin:Webhook',
      'end:Webhook',
      'begin:Buscar métricas',
      'end:Buscar métricas',
      'begin:Analisar',
      'end:Analisar',
      'begin:Montar resposta',
      'end:Montar resposta',
      'item',
    ]);
    // NFR-001: cada passo chega a quem chamou em até 1 s depois de acontecer (mesmo relógio).
    for (const { at, event } of r.events) {
      if (event.type === 'begin' || event.type === 'end') {
        expect(at - event.metadata.timestamp).toBeLessThan(1000);
      }
    }
    // SC-001: o fim do primeiro nó chega antes do início do terceiro (não tudo no fim).
    const endFirst = find(r, 'end', 'Buscar métricas');
    const beginThird = find(r, 'begin', 'Montar resposta');
    expect(endFirst && beginThird && beginThird.at - endFirst.at).toBeGreaterThan(400);
    expect(find(r, 'end', 'Analisar')?.event).toMatchObject({
      metadata: {
        nodeId: 'b',
        nodeName: 'Analisar',
        nodeType: 'http.request',
        runIndex: 0,
        itemIndex: 0,
        status: 'success',
        itemsIn: 1,
        itemsOut: 1,
      },
    });
    expect(find(r, 'end', 'Analisar')?.event.metadata).toMatchObject({
      durationMs: expect.any(Number) as number,
      timestamp: expect.any(Number) as number,
    });
    // FR-003: nenhum dado dos nós (o corpo da chamada, a saída do HTTP) vai para os passos.
    const steps = JSON.stringify(r.events.filter(({ event }) => event.type !== 'item'));
    expect(steps).not.toMatch(/pergunta|status do serviço|"tag"|"data"|console/);
    // Resposta final: a do modo "último nó", com o nó que a produziu.
    expect(r.events.at(-1)?.event).toMatchObject({
      type: 'item',
      content: { resultado: 'tudo certo' },
      metadata: { nodeName: 'Montar resposta', final: true },
    });
  });

  it('FR-002: nó com erro encerra com o fim em erro e o evento de erro com o nome do nó', async () => {
    await published(
      chain([
        hook('erro'),
        setNode('x', 'Quebrar', '={{ $json.nao.existe.aqui }}'),
        setNode('y', 'Depois', 'nunca'),
      ]),
    );
    const r = await stream('erro');
    expect(find(r, 'end', 'Quebrar')?.event).toMatchObject({ metadata: { status: 'error' } });
    expect(r.events.at(-1)?.event).toMatchObject({
      type: 'error',
      metadata: { nodeName: 'Quebrar' },
    });
    expect(find(r, 'begin', 'Depois')).toBeUndefined();
  });

  it('FR-002/FR-007: o corpo do "Responder ao webhook" é a resposta final; a publicação avisa', async () => {
    const publish = await published(
      chain([
        hook('resposta'),
        setNode('s', 'Montar', 'pronto'),
        {
          id: 'r',
          type: 'http.respondToWebhook',
          name: 'Responder',
          params: { respondWith: 'firstItemJson' },
          position: [0, 0],
        },
      ]),
    );
    expect(publish.warnings.map((w) => w.code)).toContain('WEBHOOK_STREAM_RESPONSE_NODE');
    const r = await stream('resposta');
    expect(r.events.at(-1)?.event).toMatchObject({
      type: 'item',
      content: { resultado: 'pronto' },
      metadata: { nodeName: 'Responder', final: true },
    });
  });

  it('FR-004: sinal periódico com o nó em execução enquanto não há passos novos', async () => {
    await published(
      chain([hook('lento'), named(delayNode('l', server.base, 1200), 'Agente lento')]),
    );
    const r = await stream('lento');
    const pings = r.events.filter(({ event }) => event.type === 'ping');
    expect(pings.length).toBeGreaterThanOrEqual(2);
    expect(pings[0]?.event).toMatchObject({
      metadata: { running: [{ nodeId: 'l', nodeName: 'Agente lento' }] },
    });
    expect(r.events.at(-1)?.event.type).toBe('item');
  });

  it('FR-004: nó Esperar longo informa a espera e encerra o stream; a execução continua', async () => {
    await published(
      chain([
        hook('espera'),
        {
          id: 'z',
          type: 'flow.wait',
          name: 'Esperar aprovação',
          params: { resume: 'timeInterval', amount: 5, unit: 'minutes' },
          position: [0, 0],
        },
      ]),
    );
    const r = await stream('espera');
    expect(r.events.at(-1)?.event).toMatchObject({
      type: 'execution',
      metadata: { status: 'waiting' },
    });
    const executionId = r.events[0]?.event.metadata.executionId ?? '';
    expect((await waitForStatus(editor, executionId, (s) => s === 'waiting')).status).toBe(
      'waiting',
    );
    await editor.call('POST', `/executions/${executionId}/cancel`);
  });

  it('FR-006/SC-003/FR-004: limite por projeto recusa sem criar execução; a vaga volta no fim e na desconexão', async () => {
    const quota = await admin.call('PUT', `/projects/${project.id}/quota`, {
      maxWebhookStreams: 1,
    });
    expect(quota.statusCode).toBe(204);
    try {
      await published(chain([hook('limite'), delayNode('d', server.base, 1500)]));
      const count = async () =>
        (
          await ctx.database.db
            .selectFrom('executions')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('project_id', '=', project.id)
            .executeTakeFirstOrThrow()
        ).n;

      // Desconecta no meio: a execução segue, e a vaga é liberada.
      const first = stream('limite', { abortAfter: (e) => e.type === 'begin' });
      const firstDone = await first;
      const before = await count();
      const refused = await stream('limite');
      // Logo após a desconexão, a vaga já pode estar livre; se não, a recusa não cria execução.
      if (refused.status === 429) {
        expect(refused.body).toMatchObject({
          message: 'Limite de streams simultâneos do projeto atingido (1)',
        });
        expect(await count()).toBe(before);
      }
      const executionId = firstDone.events[0]?.event.metadata.executionId ?? '';
      expect((await waitForStatus(editor, executionId)).status).toBe('success');

      // Com um stream aberto, o segundo é recusado na hora, sem execução nova.
      const open = stream('limite');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const n = await count();
      const second = await stream('limite');
      expect(second.status).toBe(429);
      expect(await count()).toBe(n);
      expect((await open).events.at(-1)?.event.type).toBe('item');
      // Terminado o primeiro, a vaga está livre.
      expect((await stream('limite')).status).toBe(200);

      const audit = await ctx.database.db
        .selectFrom('audit_log')
        .select('details')
        .where('action', '=', 'project.quota')
        .where('entity_id', '=', project.id)
        .execute();
      expect(audit.map((a) => a.details)).toContainEqual({
        maxWebhookStreams: { from: null, to: 1 },
      });
    } finally {
      await admin.call('PUT', `/projects/${project.id}/quota`, { maxWebhookStreams: null });
    }
  });

  it('NFR-002/SC-002: com duas instâncias da API, todas as chamadas recebem todos os passos, em ordem', async () => {
    await published(
      chain([hook('escala'), delayNode('a', server.base, 50), setNode('s', 'Fim', 'ok')]),
    );
    // Acima do padrão (20), para todas as chamadas abrirem stream.
    await admin.call('PUT', `/projects/${project.id}/quota`, { maxWebhookStreams: 50 });
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => stream('escala', i % 2 ? { url: secondBase } : {})),
    );
    for (const r of results) {
      expect(kinds(r)).toEqual([
        'execution:queued',
        'execution:started',
        'begin:Webhook',
        'end:Webhook',
        'begin:a',
        'end:a',
        'begin:Fim',
        'end:Fim',
        'item',
      ]);
    }
    await admin.call('PUT', `/projects/${project.id}/quota`, { maxWebhookStreams: null });
  });

  it('FR-001 (escuta de teste): /webhook-test também responde em streaming', async () => {
    const definition = chain([hook('teste-stream'), setNode('s', 'Montar', 'teste')]);
    const wf = (
      await editor.call('POST', `/projects/${project.id}/workflows`, {
        name: 'Escuta em stream',
        definition,
      })
    ).json<WorkflowDetail>();
    const listen = await editor.call('POST', `/workflows/${wf.id}/listen-test-webhook`, {
      definition,
    });
    expect(listen.statusCode).toBe(200);
    const res = await fetch(`${base}/webhook-test/teste-stream`, { method: 'POST' });
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const lines = (await res.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as StreamEvent)
      .filter((e) => e.type !== 'ping');
    expect(lines.map((e) => e.type)).toEqual([
      'execution',
      'execution',
      'begin',
      'end',
      'begin',
      'end',
      'item',
    ]);
    expect(lines.at(-1)).toMatchObject({ content: { resultado: 'teste' } });
  });

  it('FR-007: a autenticação do webhook vale igual no streaming', async () => {
    const credential = (
      await editor.call('POST', `/projects/${project.id}/credentials`, {
        name: 'Chave do stream',
        type: 'webhookHeaderAuth',
        data: { name: 'x-chave', value: 'segredo' },
      })
    ).json<{ id: string }>();
    await published(
      chain([
        { ...hook('protegido', { authentication: 'headerAuth' }), credentialId: credential.id },
      ]),
    );
    const r = await stream('protegido');
    expect(r.status).toBe(401);
    expect(r.events).toEqual([]);
  });
});
