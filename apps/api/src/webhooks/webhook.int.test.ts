import { createHmac } from 'node:crypto';
import type {
  CredentialSummary,
  ExecutionDetail,
  ListenTestWebhookResponse,
  ProjectSummary,
  PublishResponse,
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowNode,
} from '@olly/shared-types';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let editor: TestUser, executor: TestUser, viewer: TestUser;
let project: ProjectSummary;
let hmacId: string;
const SECRET = 'segredo-do-webhook';

const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

async function waitFinished(user: TestUser, executionId: string): Promise<ExecutionDetail> {
  for (let i = 0; i < 100; i++) {
    const detail = (await user.call('GET', `/executions/${executionId}`)).json<ExecutionDetail>();
    if (!['running', 'queued'].includes(detail.status)) return detail;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('execução não terminou');
}

const hook = (
  params: Record<string, unknown>,
  extra: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id: 'w',
  type: 'trigger.webhook',
  name: 'Webhook',
  params: { httpMethod: 'POST', path: 'pedidos/:id', responseMode: 'lastNode', ...params },
  position: [0, 0],
  ...extra,
});
const setNode = (value: string): WorkflowNode => ({
  id: 's',
  type: 'data.set',
  name: 'Montar',
  params: {
    fields: [
      { name: 'pedido', type: 'string', value: '={{ $json.params.id }}' },
      { name: 'total', type: 'number', value: '={{ $json.body.q * $json.body.p }}' },
      { name: 'versao', type: 'string', value },
    ],
  },
  position: [200, 0],
});
const def = (nodes: WorkflowNode[]): WorkflowDefinition => ({
  nodes,
  edges: nodes.slice(1).map((n, i) => ({
    id: `e${i}`,
    from: nodes[i]?.id ?? '',
    fromPort: 'main',
    to: n.id,
    toPort: 'main',
  })),
  settings: {},
});

async function createPublished(
  definition: WorkflowDefinition,
  user = editor,
  projectId = project.id,
) {
  const wf = (
    await user.call('POST', `/projects/${projectId}/workflows`, {
      name: `wf ${Math.random()}`,
      definition,
    })
  ).json<WorkflowDetail>();
  const res = await user.call('POST', `/workflows/${wf.id}/publish`, {
    message: 'Publicação de teste',
  });
  return { wf, res };
}

const call = (path: string, init: Omit<InjectOptions, 'url'> = {}, c = ctx) =>
  c.app.inject({ method: 'POST', url: `/webhook/${path}`, ...init });

const signed = (body: object, headers: Record<string, string> = {}) => {
  const payload = JSON.stringify(body);
  return {
    payload,
    headers: {
      'content-type': 'application/json',
      'x-signature': `sha256=${sign(payload)}`,
      ...headers,
    },
  };
};

beforeAll(async () => {
  ctx = await startTestContext();
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@t.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'Webhooks' })).json<ProjectSummary>();
  for (const [u, role] of [
    [editor, 'editor'],
    [executor, 'executor'],
    [viewer, 'viewer'],
  ] as const) {
    await admin.call('PUT', `/projects/${project.id}/members/${u.id}`, { role });
  }
  hmacId = (
    await editor.call('POST', `/projects/${project.id}/credentials`, {
      name: 'HMAC',
      type: 'webhookHmac',
      data: { secret: SECRET },
    })
  ).json<CredentialSummary>().id;
});
afterAll(async () => {
  await ctx.close();
});

const hmacHook = (params: Record<string, unknown> = {}, path = 'pedidos/:id') =>
  hook({ authentication: 'hmac', path, ...params }, { credentialId: hmacId });

describe('spec 005 — HU-1: publicar e acionar por webhook', () => {
  it('SC-002/FR-004/FR-005: HMAC válido executa e responde com o último nó; inválido dá 401', async () => {
    const { wf, res } = await createPublished(def([hmacHook(), setNode('v1')]));
    expect(res.statusCode).toBe(200);
    expect(res.json<PublishResponse>()).toMatchObject({
      publishedVersion: 1,
      active: true,
      webhooks: [{ method: 'POST', path: 'pedidos/:id' }],
    });
    const ok = await call('pedidos/42', signed({ q: 3, p: 5 }));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ pedido: '42', total: 15, versao: 'v1' });

    expect(
      (await call('pedidos/42', signed({ q: 3, p: 5 }, { 'x-signature': 'sha256=errada' })))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await call('pedidos/42', {
          payload: '{"q":1}',
          headers: { 'content-type': 'application/json' },
        })
      ).statusCode,
    ).toBe(401);
    // Corpo alterado depois de assinado.
    const tampered = signed({ q: 3, p: 5 });
    expect((await call('pedidos/42', { ...tampered, payload: '{"q":300,"p":5}' })).statusCode).toBe(
      401,
    );
    expect((await call('nao-existe', signed({}))).statusCode).toBe(404);
    const detail = (await editor.call('GET', `/workflows/${wf.id}`)).json<WorkflowDetail>();
    expect(detail).toMatchObject({ publishedVersion: 1, active: true });
  });

  it('SC-007/FR-001: a produção usa a versão publicada mesmo com o rascunho alterado', async () => {
    const { wf } = await createPublished(def([hmacHook({}, 'versoes/:id'), setNode('publicada')]));
    const saved = await editor.call('PUT', `/workflows/${wf.id}`, {
      definition: def([hmacHook({}, 'versoes/:id'), setNode('rascunho')]),
      baseVersion: 1,
    });
    expect(saved.statusCode).toBe(200);
    expect((await call('versoes/1', signed({ q: 1, p: 1 }))).json()).toMatchObject({
      versao: 'publicada',
    });
    await editor.call('POST', `/workflows/${wf.id}/publish`, {
      version: 2,
      message: 'Publicação de teste',
    });
    expect((await call('versoes/1', signed({ q: 1, p: 1 }))).json()).toMatchObject({
      versao: 'rascunho',
    });
    await editor.call('POST', `/workflows/${wf.id}/publish`, {
      version: 1,
      message: 'Publicação de teste',
    });
    expect((await call('versoes/1', signed({ q: 1, p: 1 }))).json()).toMatchObject({
      versao: 'publicada',
    });

    const off = await editor.call('POST', `/workflows/${wf.id}/unpublish`);
    expect(off.json<PublishResponse>()).toMatchObject({ active: false, publishedVersion: 1 });
    expect((await call('versoes/1', signed({ q: 1, p: 1 }))).statusCode).toBe(404);
  });

  it('SC-003/FR-005: modo imediato devolve 202 com o id; a execução fica registrada como produção', async () => {
    await createPublished(
      def([hook({ path: 'imediato', responseMode: 'onReceived' }), setNode('x')]),
    );
    const res = await call('imediato?origem=teste', {
      payload: JSON.stringify({ q: 2, p: 2 }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer nao-vai-para-o-item',
        cookie: 'a=b',
      },
    });
    expect(res.statusCode).toBe(202);
    const { executionId } = res.json<{ executionId: string }>();
    const detail = await waitFinished(editor, executionId);
    expect(detail).toMatchObject({
      status: 'success',
      mode: 'production',
      triggerType: 'webhook',
      triggeredBy: null,
    });
    const item = detail.nodes.find((n) => n.nodeId === 'w')?.output?.main?.[0]?.json as {
      headers: Record<string, string>;
      query: Record<string, string>;
      body: unknown;
    };
    expect(item.query).toEqual({ origem: 'teste' });
    expect(item.body).toEqual({ q: 2, p: 2 });
    expect(item.headers).not.toHaveProperty('authorization');
    expect(item.headers).not.toHaveProperty('cookie');
    expect(item.headers['content-type']).toBe('application/json');
  });

  it('FR-004: corpo JSON sem Content-Type de JSON (fetch sem cabeçalho, curl -d) vira objeto', async () => {
    await createPublished(
      def([hook({ path: 'corpos', responseMode: 'onReceived' }), setNode('x')]),
    );
    const bodyOf = async (payload: string, contentType: string) => {
      const res = await call('corpos', { payload, headers: { 'content-type': contentType } });
      expect(res.statusCode).toBe(202);
      const detail = await waitFinished(editor, res.json<{ executionId: string }>().executionId);
      return (
        detail.nodes.find((n) => n.nodeId === 'w')?.output?.main?.[0]?.json as {
          body: unknown;
        }
      ).body;
    };
    const json = JSON.stringify({ pergunta: 'Que dia é hoje?', itens: [1, 2] });
    // `fetch(url, { body: JSON.stringify(x) })` envia text/plain.
    expect(await bodyOf(json, 'text/plain;charset=UTF-8')).toEqual({
      pergunta: 'Que dia é hoje?',
      itens: [1, 2],
    });
    // `curl -d '{...}'` envia application/x-www-form-urlencoded.
    expect(await bodyOf(json, 'application/x-www-form-urlencoded')).toEqual({
      pergunta: 'Que dia é hoje?',
      itens: [1, 2],
    });
    // O que não é JSON continua como antes.
    expect(await bodyOf('olá, mundo', 'text/plain')).toBe('olá, mundo');
    expect(await bodyOf('{ não é json', 'text/plain')).toBe('{ não é json');
    expect(await bodyOf('a=1&b=2', 'application/x-www-form-urlencoded')).toEqual({
      a: '1',
      b: '2',
    });
  });

  it('SC-003/FR-008: nó de resposta define status, cabeçalhos e corpo; só a primeira vale', async () => {
    const respond = (id: string, params: Record<string, unknown>): WorkflowNode => ({
      id,
      type: 'http.respondToWebhook',
      name: `Responder ${id}`,
      params,
      position: [0, 0],
    });
    await createPublished(
      def([
        hook({ path: 'resposta', responseMode: 'responseNode' }),
        respond('r1', {
          respondWith: 'text',
          responseBody: '=pedido {{ $json.body.id }} aceito',
          responseCode: 201,
          responseHeaders: [{ name: 'X-Origem', value: 'olly' }],
        }),
        respond('r2', { respondWith: 'text', responseBody: 'segunda', responseCode: 500 }),
      ]),
    );
    const res = await call('resposta', {
      payload: '{"id":7}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['x-origem']).toBe('olly');
    expect(res.body).toBe('pedido 7 aceito');

    await createPublished(
      def([
        hook({ path: 'resposta-json', responseMode: 'responseNode' }),
        respond('r', { respondWith: 'allItemsJson' }),
      ]),
    );
    const json = await call('resposta-json', {
      payload: '{"a":1}',
      headers: { 'content-type': 'application/json' },
    });
    expect(json.statusCode).toBe(200);
    expect(json.json<{ body: unknown }[]>()[0]?.body).toEqual({ a: 1 });
  });

  it('FR-005: modo nó de resposta sem resposta executada responde 500 com o id', async () => {
    const respond: WorkflowNode = {
      id: 'r',
      type: 'http.respondToWebhook',
      name: 'Responder',
      params: {},
      position: [0, 0],
      disabled: false,
    };
    // O nó de resposta fica num ramo que não recebe itens (If falso).
    const definition: WorkflowDefinition = {
      nodes: [
        hook({ path: 'sem-resposta', responseMode: 'responseNode' }),
        {
          id: 'i',
          type: 'logic.if',
          name: 'Nunca',
          params: {
            conditions: {
              combinator: 'and',
              conditions: [
                {
                  leftValue: '1',
                  rightValue: '2',
                  operator: { type: 'number', operation: 'equals' },
                },
              ],
            },
          },
          position: [0, 0],
        },
        respond,
      ],
      edges: [
        { id: 'a', from: 'w', fromPort: 'main', to: 'i', toPort: 'main' },
        { id: 'b', from: 'i', fromPort: 'true', to: 'r', toPort: 'main' },
      ],
      settings: {},
    };
    await createPublished(definition);
    const res = await call('sem-resposta');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      message: 'O workflow terminou sem executar o nó "Responder ao webhook"',
      executionId: expect.any(String) as string,
    });
  });

  it('FR-002: validações da publicação e permissão workflow:publish', async () => {
    const make = async (definition: WorkflowDefinition) =>
      (
        await editor.call('POST', `/projects/${project.id}/workflows`, {
          name: `v ${Math.random()}`,
          definition,
        })
      ).json<WorkflowDetail>();
    const noAuth = await createPublished(def([hook({ path: 'sem-auth' })]));
    expect(noAuth.res.json<PublishResponse>().warnings.map((w) => w.code)).toEqual([
      'WEBHOOK_NO_AUTH',
    ]);

    const invalid = await make(def([hook({ path: 'com espaço' })]));
    const r1 = await editor.call('POST', `/workflows/${invalid.id}/publish`, {
      message: 'Publicação de teste',
    });
    expect(r1.statusCode).toBe(422);
    expect(r1.body).toContain('WEBHOOK_PATH_INVALID');

    const noResponder = await make(def([hook({ path: 'x1', responseMode: 'responseNode' })]));
    expect(
      (
        await editor.call('POST', `/workflows/${noResponder.id}/publish`, {
          message: 'Publicação de teste',
        })
      ).body,
    ).toContain('WEBHOOK_NO_RESPONSE_NODE');

    const noCredential = await make(def([hook({ path: 'x2', authentication: 'hmac' })]));
    expect(
      (
        await editor.call('POST', `/workflows/${noCredential.id}/publish`, {
          message: 'Publicação de teste',
        })
      ).body,
    ).toContain('WEBHOOK_CREDENTIAL_INVALID');

    const clash = await make(def([hook({ path: 'sem-auth' })]));
    expect(
      (
        await editor.call('POST', `/workflows/${clash.id}/publish`, {
          message: 'Publicação de teste',
        })
      ).statusCode,
    ).toBe(409);

    for (const user of [executor, viewer]) {
      expect(
        (
          await user.call('POST', `/workflows/${clash.id}/publish`, {
            message: 'Publicação de teste',
          })
        ).statusCode,
      ).toBe(403);
      expect((await user.call('POST', `/workflows/${clash.id}/unpublish`)).statusCode).toBe(403);
    }
  });

  it('FR-001: workflow excluído deixa de responder', async () => {
    const { wf } = await createPublished(
      def([hook({ path: 'apagado', responseMode: 'onReceived' })]),
    );
    expect((await call('apagado')).statusCode).toBe(202);
    await editor.call('DELETE', `/workflows/${wf.id}`);
    expect((await call('apagado')).statusCode).toBe(404);
  });

  it('FR-006: CORS (preflight e resposta) e allowlist de IP', async () => {
    await createPublished(
      def([
        hook({
          path: 'cors',
          responseMode: 'onReceived',
          options: { allowedOrigins: 'https://portal.gov.br' },
        }),
      ]),
    );
    const preflight = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/webhook/cors',
      headers: { origin: 'https://portal.gov.br', 'access-control-request-method': 'POST' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://portal.gov.br');
    const other = await call('cors', { headers: { origin: 'https://outro.com' } });
    expect(other.statusCode).toBe(202);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();

    await createPublished(
      def([
        hook({ path: 'ip', responseMode: 'onReceived', options: { ipAllowlist: '10.0.0.0/8' } }),
      ]),
    );
    expect((await call('ip')).statusCode).toBe(403);
    await createPublished(
      def([
        hook({ path: 'ip-ok', responseMode: 'onReceived', options: { ipAllowlist: '127.0.0.1' } }),
      ]),
    );
    expect((await call('ip-ok')).statusCode).toBe(202);
  });
});

describe('spec 005 — HU-2/FR-007: webhook de teste', () => {
  it('FR-007: a escuta executa a definição do editor (não salva) uma vez', async () => {
    const wf = (
      await editor.call('POST', `/projects/${project.id}/workflows`, { name: 'Teste webhook' })
    ).json<WorkflowDetail>();
    const definition = def([
      hook({ path: 'escuta/:id', responseMode: 'lastNode' }),
      setNode('editor'),
    ]);
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/webhook-test/escuta/1' })).statusCode,
    ).toBe(404);
    const listen = await editor.call('POST', `/workflows/${wf.id}/listen-test-webhook`, {
      definition,
    });
    expect(listen.statusCode).toBe(200);
    expect(listen.json<ListenTestWebhookResponse>().webhooks).toEqual([
      { nodeId: 'w', method: 'POST', path: 'escuta/:id' },
    ]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/webhook-test/escuta/9',
      payload: '{"q":2,"p":4}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pedido: '9', total: 8, versao: 'editor' });
    // A escuta foi consumida.
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/webhook-test/escuta/9' })).statusCode,
    ).toBe(404);

    const list = (
      await editor.call('GET', `/executions?workflowId=${wf.id}&trigger=webhook`)
    ).json<{ items: { mode: string; triggeredBy: string }[] }>();
    expect(list.items[0]).toMatchObject({ mode: 'test', triggeredBy: editor.id });
  });

  it('FR-007/HU-2.1: escuta pelo nó executa só o Webhook; o próximo nó reaproveita o payload', async () => {
    const wf = (
      await editor.call('POST', `/projects/${project.id}/workflows`, { name: 'Passo a passo' })
    ).json<WorkflowDetail>();
    const definition = def([
      hook({ path: 'passo/:id', responseMode: 'responseNode' }),
      setNode('passo'),
    ]);
    const listen = await editor.call('POST', `/workflows/${wf.id}/listen-test-webhook`, {
      definition,
      destinationNodeId: 'w',
    });
    expect(listen.statusCode).toBe(200);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/webhook-test/passo/5',
      payload: '{"q":2,"p":3}',
      headers: { 'content-type': 'application/json' },
    });
    // Para no Webhook: a chamada recebe 202 mesmo no modo "nó de resposta".
    expect(res.statusCode).toBe(202);
    const { executionId } = res.json<{ executionId: string }>();
    const first = await waitFinished(editor, executionId);
    expect(first.status).toBe('success');
    expect(first.nodes.map((n) => n.nodeId)).toEqual(['w']);
    expect(first.nodes[0]?.output?.main?.[0]?.json).toMatchObject({
      params: { id: '5' },
      body: { q: 2, p: 3 },
    });

    // ▶ no próximo nó: o Webhook é reaproveitado com o payload recebido.
    const next = await editor.call('POST', `/workflows/${wf.id}/test-run`, {
      definition,
      destinationNodeId: 's',
      reuse: { w: executionId },
    });
    const second = await waitFinished(editor, next.json<{ executionId: string }>().executionId);
    expect(second.nodes.find((n) => n.nodeId === 'w')).toMatchObject({ reused: true });
    expect(second.nodes.find((n) => n.nodeId === 's')?.output?.main?.[0]?.json).toEqual({
      pedido: '5',
      total: 6,
      versao: 'passo',
    });
  });

  it('FR-007: só quem executa pode escutar; workflow sem webhook é recusado', async () => {
    const wf = (
      await editor.call('POST', `/projects/${project.id}/workflows`, { name: 'Sem webhook' })
    ).json<WorkflowDetail>();
    const definition = def([hook({ path: 'perm' })]);
    expect(
      (await viewer.call('POST', `/workflows/${wf.id}/listen-test-webhook`, { definition }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await editor.call('POST', `/workflows/${wf.id}/listen-test-webhook`, {
          definition: def([]),
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await executor.call('POST', `/workflows/${wf.id}/listen-test-webhook`, { definition }))
        .statusCode,
    ).toBe(200);
    expect(
      (await executor.call('DELETE', `/workflows/${wf.id}/listen-test-webhook`)).statusCode,
    ).toBe(204);
    expect((await ctx.app.inject({ method: 'POST', url: '/webhook-test/perm' })).statusCode).toBe(
      404,
    );
  });
});

describe('spec 005 — FR-006/NFR-001/FR-002: limites', () => {
  let small: TestContext;
  let user: TestUser;
  let projectId: string;
  beforeAll(async () => {
    small = await startTestContext({
      webhook: {
        maxBodyBytes: 1024,
        responseTimeoutMs: 300,
        rateLimitPerMin: 3,
        requireAuth: false,
      },
    });
    user = await loginAs(small, { sub: 'a', email: 'a@t.local', groups: ['admin'] });
    projectId = (await user.call('POST', '/projects', { name: 'Limites' })).json<ProjectSummary>()
      .id;
  });
  afterAll(async () => {
    await small.close();
  });

  it('FR-006/NFR-001: payload acima do limite dá 413; rate limit por rota dá 429', async () => {
    await createPublished(
      def([hook({ path: 'limite', responseMode: 'onReceived' })]),
      user,
      projectId,
    );
    const big = await call(
      'limite',
      { payload: 'x'.repeat(2048), headers: { 'content-type': 'text/plain' } },
      small,
    );
    expect(big.statusCode).toBe(413);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await call('limite', {}, small)).statusCode);
    // O 413 é cortado antes do handler e não conta no rate limit.
    expect(statuses).toEqual([202, 202, 202, 429]);
  });

  it('caso de borda: resposta síncrona além do limite dá 504 com o id, e a execução continua', async () => {
    const slow: WorkflowNode = {
      id: 'c',
      type: 'code.javascript',
      name: 'Demora',
      params: {
        jsCode: 'const s = Date.now(); while (Date.now() - s < 1500) {} return { pronto: true };',
      },
      position: [0, 0],
    };
    await createPublished(def([hook({ path: 'lento' }), slow]), user, projectId);
    const res = await call('lento', {}, small);
    expect(res.statusCode).toBe(504);
    const { executionId } = res.json<{ executionId: string }>();
    const detail = await waitFinished(user, executionId);
    expect(detail.status).toBe('success');
  });

  it('FR-002: com OLLY_REQUIRE_WEBHOOK_AUTH, webhook sem autenticação não publica', async () => {
    const strict = await startTestContext({
      webhook: {
        maxBodyBytes: 1024,
        responseTimeoutMs: 300,
        rateLimitPerMin: 3,
        requireAuth: true,
      },
    });
    try {
      const admin = await loginAs(strict, { sub: 'a', email: 'a@t.local', groups: ['admin'] });
      const pid = (
        await admin.call('POST', '/projects', { name: 'Estrito' })
      ).json<ProjectSummary>().id;
      const { res } = await createPublished(def([hook({ path: 'aberto' })]), admin, pid);
      expect(res.statusCode).toBe(422);
      expect(res.body).toContain('WEBHOOK_NO_AUTH');
    } finally {
      await strict.close();
    }
  });
});
