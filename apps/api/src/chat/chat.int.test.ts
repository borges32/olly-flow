import { randomUUID } from 'node:crypto';
import type {
  ChatConfig,
  ChatTestReply,
  ChatTestStart,
  CredentialSummary,
  ExecutionDetail,
  ExecutionList,
  ProjectSummary,
  PublishResponse,
  StreamEvent,
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowNode,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentWorkflow, allowModels, fakeModelCredential } from '../testing/ai.js';
import {
  createWorkflow,
  delayNode,
  edge,
  startDelayServer,
  waitForStatus,
  type DelayServer,
} from '../testing/execution-helpers.js';
import { startTestMinio, type TestMinio } from '../testing/minio.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

/**
 * Spec 021 (T022, T030, T040): Chat Trigger pela API, com o modelo simulado, o Redis e o banco
 * reais: painel do editor, chat publicado (página e HTTP), autenticações, sessão anterior,
 * arquivos, limites e mensagens da mesma sessão em sequência.
 */
let ctx: TestContext;
let strict: TestContext;
let minio: TestMinio;
let server: DelayServer;
let editor: TestUser, viewer: TestUser;
let project: ProjectSummary;
let strictEditor: TestUser;
let strictProject: ProjectSummary;

interface Run {
  start: number;
  end: number;
}

/** Responde a última pergunta e conta as mensagens enviadas ao modelo (memória). */
const ECHO = [{ content: 'Recebi: {{lastHuman}} ({{messageCount}})', repeat: true }];

const chatNode = (
  params: Record<string, unknown> = {},
  extra: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id: 'chat',
  type: 'trigger.chat',
  name: 'Chat',
  params: { webhookId: randomUUID(), ...params },
  position: [0, 0],
  ...extra,
});

const memoryNode: WorkflowNode = {
  id: 'mem',
  type: 'memory.postgres',
  name: 'Memória',
  // O editor preenche o padrão ao criar o nó; pela API, o parâmetro vai explícito.
  params: { sessionKey: '={{ $json.sessionId }}' },
  position: [300, 300],
};

async function chatAgent(
  user: TestUser,
  projectId: string,
  trigger: WorkflowNode,
  options: { memoryOnTrigger?: boolean } = {},
): Promise<WorkflowDefinition> {
  const def = agentWorkflow({
    credentialId: await fakeModelCredential(user, projectId, ECHO),
    trigger,
    memory: memoryNode,
    agentParams: { promptSource: 'fromInput' },
  });
  if (options.memoryOnTrigger) {
    def.edges.push({
      id: 'mem-chat',
      from: 'mem',
      fromPort: 'ai_memory',
      to: trigger.id,
      toPort: 'ai_memory',
    });
  }
  return def;
}

async function publish(
  user: TestUser,
  projectId: string,
  definition: WorkflowDefinition,
): Promise<{ wf: WorkflowDetail; res: PublishResponse; status: number; body: string }> {
  const wf = await createWorkflow(user, projectId, definition);
  const res = await user.call('POST', `/workflows/${wf.id}/publish`, { message: 'Chat' });
  return { wf, res: res.json<PublishResponse>(), status: res.statusCode, body: res.body };
}

const webhookIdOf = (def: WorkflowDefinition) =>
  String(def.nodes.find((n) => n.type === 'trigger.chat')?.params.webhookId);

const post = (
  c: TestContext,
  webhookId: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
) => c.app.inject({ method: 'POST', url: `/webhook/${webhookId}/chat`, payload, headers });

async function sendTest(
  user: TestUser,
  wf: WorkflowDetail,
  sessionId: string,
  chatInput: string,
): Promise<{ executionId: string; reply: ChatTestReply }> {
  const start = await user.call('POST', `/workflows/${wf.id}/chat/test`, {
    definition: wf.definition,
    sessionId,
    chatInput,
  });
  expect(start.statusCode, start.body).toBe(202);
  const { executionId } = start.json<ChatTestStart>();
  const reply = await user.call('GET', `/workflows/${wf.id}/chat/test/${executionId}/reply`);
  expect(reply.statusCode, reply.body).toBe(200);
  return { executionId, reply: reply.json<ChatTestReply>() };
}

async function executionsOf(user: TestUser, workflowId: string) {
  return (await user.call('GET', `/executions?workflowId=${workflowId}`)).json<ExecutionList>()
    .items;
}

beforeAll(async () => {
  [minio, server] = await Promise.all([startTestMinio(), startDelayServer()]);
  ctx = await startTestContext({
    s3: minio.config,
    http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 },
  });
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@chat.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@chat.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@chat.local' });
  project = (await admin.call('POST', '/projects', { name: 'Chat' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  await admin.call('PUT', `/projects/${project.id}/members/${viewer.id}`, { role: 'viewer' });
  await allowModels(admin, ['fake-model']);

  // Autenticação obrigatória, tempo de resposta curto, poucas mensagens por minuto e mensagens
  // curtas: FR-004, FR-005, FR-009 e FR-014 (espera esgotada).
  strict = await startTestContext({
    webhook: {
      maxBodyBytes: 1024 * 1024,
      responseTimeoutMs: 1500,
      rateLimitPerMin: 4,
      requireAuth: true,
      streamMaxPerProject: 20,
      streamPingMs: 15_000,
    },
    chat: { maxMessageChars: 50 },
    http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 },
  });
  const strictAdmin = await loginAs(strict, {
    sub: 'admin',
    email: 'admin@strict.local',
    groups: ['admin'],
  });
  strictEditor = await loginAs(strict, { sub: 'editor', email: 'editor@strict.local' });
  strictProject = (
    await strictAdmin.call('POST', '/projects', { name: 'Chat estrito' })
  ).json<ProjectSummary>();
  await strictAdmin.call('PUT', `/projects/${strictProject.id}/members/${strictEditor.id}`, {
    role: 'editor',
  });
  await allowModels(strictAdmin, ['fake-model']);
}, 180_000);

afterAll(async () => {
  await Promise.all([ctx.close(), strict.close()]);
  await Promise.all([minio.stop(), server.close()]);
});

describe('spec 021 — painel de chat do editor', () => {
  it('SC-001/FR-002/FR-011: três mensagens na mesma sessão; o Agent lê o chatInput e a memória guarda o contexto', async () => {
    const wf = await createWorkflow(
      editor,
      project.id,
      await chatAgent(editor, project.id, chatNode()),
    );
    const session = randomUUID();
    const first = await sendTest(editor, wf, session, 'Oi');
    const second = await sendTest(editor, wf, session, 'Tudo bem?');
    const third = await sendTest(editor, wf, session, 'Até logo');
    expect(first.reply).toMatchObject({
      status: 'success',
      message: expect.stringContaining('Recebi: Oi') as string,
    });
    expect(second.reply.message).toContain('Recebi: Tudo bem?');
    // A memória acrescenta as mensagens anteriores ao pedido (FR-011 com a memória da spec 011).
    const count = (m: string) => Number(/\((\d+)\)/.exec(m)?.[1]);
    expect(count(second.reply.message)).toBeGreaterThan(count(first.reply.message));
    expect(count(third.reply.message)).toBeGreaterThan(count(second.reply.message));

    const detail = await waitForStatus(editor, first.executionId);
    expect(detail).toMatchObject({ mode: 'test', triggerType: 'chat' });
    expect(detail.nodes.find((n) => n.nodeId === 'chat')?.output?.main?.[0]?.json).toEqual({
      sessionId: session,
      action: 'sendMessage',
      chatInput: 'Oi',
    });

    // Nova sessão: começa sem contexto.
    const other = await sendTest(editor, wf, randomUUID(), 'Oi');
    expect(count(other.reply.message)).toBe(count(first.reply.message));
  });

  it('FR-002: erro do workflow aparece no lugar da resposta; sem gatilho de chat ou sem permissão, recusa', async () => {
    const broken = await chatAgent(editor, project.id, chatNode());
    broken.nodes = broken.nodes.map((n) =>
      n.id === 'agent'
        ? { ...n, params: { promptSource: 'define', text: '={{ $json.nada.x }}' } }
        : n,
    );
    const wf = await createWorkflow(editor, project.id, broken);
    const { reply } = await sendTest(editor, wf, randomUUID(), 'Oi');
    expect(reply.status).toBe('error');
    expect(reply.message).toBeTruthy();

    const noChat = await createWorkflow(editor, project.id, {
      nodes: [{ id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] }],
      edges: [],
      settings: {},
    });
    const refused = await editor.call('POST', `/workflows/${noChat.id}/chat/test`, {
      definition: noChat.definition,
      sessionId: 's',
      chatInput: 'Oi',
    });
    expect(refused.statusCode).toBe(422);

    const forbidden = await viewer.call('POST', `/workflows/${wf.id}/chat/test`, {
      definition: wf.definition,
      sessionId: 's',
      chatInput: 'Oi',
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe('spec 021 — chat publicado', () => {
  it('SC-002/FR-003/FR-008/NFR-004: página com a configuração, resposta do Agent em produção; despublicado, indisponível', async () => {
    const trigger = chatNode({
      public: true,
      initialMessages: 'Olá!\nSou o assistente.',
      options: { title: 'Suporte' },
    });
    const def = await chatAgent(editor, project.id, trigger);
    const { wf, status, res } = await publish(editor, project.id, def);
    expect(status).toBe(200);
    // Sem autenticação obrigatória na instalação, "Nenhuma" só gera aviso (como o webhook).
    expect(res.warnings.map((w) => w.code)).toContain('CHAT_NO_AUTH');
    const id = webhookIdOf(def);

    const page = await ctx.app.inject({ method: 'GET', url: `/webhook/${id}/chat` });
    expect(page.statusCode).toBe(200);
    const config = page.json<ChatConfig>();
    expect(config).toMatchObject({
      title: 'Suporte',
      initialMessages: ['Olá!', 'Sou o assistente.'],
      authentication: 'none',
    });
    expect(page.body).not.toContain('Agente');
    expect(page.body).not.toContain(wf.id);

    const answer = await post(ctx, id, {
      action: 'sendMessage',
      sessionId: 'p-1',
      chatInput: 'Oi',
    });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json<{ output: string }>().output).toContain('Recebi: Oi');
    const [execution] = await executionsOf(editor, wf.id);
    expect(execution).toMatchObject({ mode: 'production', triggerType: 'chat' });

    await editor.call('POST', `/workflows/${wf.id}/unpublish`, {});
    const gone = await post(ctx, id, { action: 'sendMessage', sessionId: 'p-1', chatInput: 'Oi' });
    expect(gone.statusCode).toBe(404);
  });

  it('SC-003/FR-003: modo incorporado responde no formato do N8N, com CORS das origens permitidas', async () => {
    const trigger = chatNode({
      public: true,
      mode: 'webhook',
      options: { allowedOrigins: 'https://intranet.local' },
    });
    const def = await chatAgent(editor, project.id, trigger);
    await publish(editor, project.id, def);
    const id = webhookIdOf(def);
    const answer = await post(
      ctx,
      id,
      { action: 'sendMessage', sessionId: 'emb', chatInput: 'Olá' },
      { origin: 'https://intranet.local' },
    );
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({
      output: expect.stringContaining('Recebi: Olá') as string,
    });
    expect(answer.headers['access-control-allow-origin']).toBe('https://intranet.local');
    const other = await post(
      ctx,
      id,
      { action: 'sendMessage', sessionId: 'emb', chatInput: 'Olá' },
      { origin: 'https://outro.local' },
    );
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await ctx.app.inject({
      method: 'OPTIONS',
      url: `/webhook/${id}/chat`,
      headers: { origin: 'https://intranet.local', 'access-control-request-method': 'POST' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toBe('GET, POST');
  });

  it('FR-004: Basic Auth e usuário do Olly Flow', async () => {
    const credentialId = (
      await editor.call('POST', `/projects/${project.id}/credentials`, {
        name: 'Chat Basic',
        type: 'webhookBasicAuth',
        data: { user: 'ana', password: 'segredo-1' },
      })
    ).json<CredentialSummary>().id;
    const basic = await chatAgent(
      editor,
      project.id,
      chatNode({ public: true, authentication: 'basicAuth' }, { credentialId }),
    );
    await publish(editor, project.id, basic);
    const basicId = webhookIdOf(basic);
    const message = { action: 'sendMessage', sessionId: 'b', chatInput: 'Oi' };
    expect((await post(ctx, basicId, message)).statusCode).toBe(401);
    const wrong = `Basic ${Buffer.from('ana:errada').toString('base64')}`;
    expect((await post(ctx, basicId, message, { authorization: wrong })).statusCode).toBe(401);
    const right = `Basic ${Buffer.from('ana:segredo-1').toString('base64')}`;
    expect((await post(ctx, basicId, message, { authorization: right })).statusCode).toBe(200);

    const olly = await chatAgent(
      editor,
      project.id,
      chatNode({ public: true, authentication: 'ollyUserAuth' }),
    );
    const { wf } = await publish(editor, project.id, olly);
    const ollyId = webhookIdOf(olly);
    expect((await post(ctx, ollyId, message)).statusCode).toBe(401);
    const page = await ctx.app.inject({
      method: 'GET',
      url: `/webhook/${ollyId}/chat`,
      headers: { authorization: `Bearer ${viewer.token}` },
    });
    expect(page.statusCode).toBe(200);
    const ok = await post(ctx, ollyId, message, { authorization: `Bearer ${viewer.token}` });
    expect(ok.statusCode).toBe(200);
    // A execução fica registrada com o usuário que conversou.
    const [execution] = await executionsOf(editor, wf.id);
    expect(execution?.triggerType).toBe('chat');
  });

  it('FR-004: com a autenticação obrigatória na instalação, publicar o chat sem autenticação é recusado', async () => {
    const def = await chatAgent(strictEditor, strictProject.id, chatNode({ public: true }));
    const { status, body } = await publish(strictEditor, strictProject.id, def);
    expect(status).toBe(422);
    expect(body).toContain('CHAT_NO_AUTH');
  });

  it('FR-005: resposta pelo nó "Responder ao webhook"; erro do workflow; tempo esgotado', async () => {
    const respond: WorkflowDefinition = {
      nodes: [
        chatNode({ public: true, options: { responseMode: 'responseNode' } }),
        {
          id: 's',
          type: 'data.set',
          name: 'Montar',
          params: {
            fields: [{ name: 'output', type: 'string', value: '=Resposta: {{ $json.chatInput }}' }],
          },
          position: [200, 0],
        },
        {
          id: 'r',
          type: 'http.respondToWebhook',
          name: 'Responder',
          params: { respondWith: 'firstItemJson' },
          position: [400, 0],
        },
      ],
      edges: [edge('chat', 's'), edge('s', 'r')],
      settings: {},
    };
    await publish(editor, project.id, respond);
    const answer = await post(ctx, webhookIdOf(respond), {
      action: 'sendMessage',
      sessionId: 'r',
      chatInput: 'oi',
    });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toMatchObject({ output: 'Resposta: oi' });

    const failing: WorkflowDefinition = {
      nodes: [
        chatNode({ public: true }),
        {
          id: 's',
          type: 'data.set',
          name: 'Falha',
          params: { fields: [{ name: 'x', type: 'string', value: '={{ $json.a.b }}' }] },
          position: [200, 0],
        },
      ],
      edges: [edge('chat', 's')],
      settings: {},
    };
    await publish(editor, project.id, failing);
    const failed = await post(ctx, webhookIdOf(failing), {
      action: 'sendMessage',
      sessionId: 'f',
      chatInput: 'oi',
    });
    expect(failed.statusCode).toBe(500);

    const credentialId = (
      await strictEditor.call('POST', `/projects/${strictProject.id}/credentials`, {
        name: 'Basic lento',
        type: 'webhookBasicAuth',
        data: { user: 'u', password: 'p' },
      })
    ).json<CredentialSummary>().id;
    const slow: WorkflowDefinition = {
      nodes: [
        chatNode({ public: true, authentication: 'basicAuth' }, { credentialId }),
        delayNode('lento', server.base, 3000),
      ],
      edges: [edge('chat', 'lento')],
      settings: {},
    };
    await publish(strictEditor, strictProject.id, slow);
    const auth = { authorization: `Basic ${Buffer.from('u:p').toString('base64')}` };
    const timeout = await post(
      strict,
      webhookIdOf(slow),
      { action: 'sendMessage', sessionId: 't', chatInput: 'oi' },
      auth,
    );
    expect(timeout.statusCode).toBe(504);
  });

  it('SC-005/FR-006: a sessão anterior vem da memória ligada ao gatilho; sem a opção, vazia', async () => {
    const trigger = chatNode({ public: true, options: { loadPreviousSession: 'memory' } });
    const def = await chatAgent(editor, project.id, trigger, { memoryOnTrigger: true });
    const { status, body } = await publish(editor, project.id, def);
    expect(status, body).toBe(200);
    const id = webhookIdOf(def);
    await post(ctx, id, { action: 'sendMessage', sessionId: 'hist', chatInput: 'Primeira' });
    await post(ctx, id, { action: 'sendMessage', sessionId: 'hist', chatInput: 'Segunda' });
    const history = await post(ctx, id, { action: 'loadPreviousSession', sessionId: 'hist' });
    expect(history.statusCode).toBe(200);
    const data = history.json<{ data: { id: string[]; kwargs: { content: string } }[] }>().data;
    expect(data.map((m) => [m.id.at(-1), m.kwargs.content])).toEqual([
      ['HumanMessage', 'Primeira'],
      ['AIMessage', expect.stringContaining('Recebi: Primeira') as string],
      ['HumanMessage', 'Segunda'],
      ['AIMessage', expect.stringContaining('Recebi: Segunda') as string],
    ]);
    // Outra sessão não vê esta conversa.
    const empty = await post(ctx, id, { action: 'loadPreviousSession', sessionId: 'outra' });
    expect(empty.json()).toEqual({ data: [] });

    const plain = await chatAgent(editor, project.id, chatNode({ public: true }));
    await publish(editor, project.id, plain);
    const none = await post(ctx, webhookIdOf(plain), {
      action: 'loadPreviousSession',
      sessionId: 'hist',
    });
    expect(none.json()).toEqual({ data: [] });
  });

  it('FR-007: arquivos permitidos viram binários do item; tipo não permitido é recusado', async () => {
    const def: WorkflowDefinition = {
      nodes: [
        chatNode({
          public: true,
          options: { allowFileUploads: true, allowedFilesMimeTypes: 'text/plain,image/*' },
        }),
      ],
      edges: [],
      settings: {},
    };
    const { wf } = await publish(editor, project.id, def);
    const id = webhookIdOf(def);
    const boundary = 'olly-chat-boundary';
    const multipart = (fileName: string, mimeType: string, content: string) =>
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="action"',
        '',
        'sendMessage',
        `--${boundary}`,
        'Content-Disposition: form-data; name="sessionId"',
        '',
        'arq',
        `--${boundary}`,
        'Content-Disposition: form-data; name="chatInput"',
        '',
        'Veja o anexo',
        `--${boundary}`,
        `Content-Disposition: form-data; name="files"; filename="${fileName}"`,
        `Content-Type: ${mimeType}`,
        '',
        content,
        `--${boundary}--`,
        '',
      ].join('\r\n');
    const headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/webhook/${id}/chat`,
      headers,
      payload: multipart('nota.txt', 'text/plain', 'conteúdo do arquivo'),
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const [execution] = await executionsOf(editor, wf.id);
    const detail = (
      await editor.call('GET', `/executions/${String(execution?.id)}`)
    ).json<ExecutionDetail>();
    const item = detail.nodes.find((n) => n.nodeId === 'chat')?.output?.main?.[0];
    expect(item?.json).toMatchObject({
      chatInput: 'Veja o anexo',
      files: [{ fileName: 'nota.txt', mimeType: 'text/plain', fileExtension: 'txt' }],
    });
    expect(item?.binary?.data0).toMatchObject({ mimeType: 'text/plain', fileName: 'nota.txt' });

    const refused = await ctx.app.inject({
      method: 'POST',
      url: `/webhook/${id}/chat`,
      headers,
      payload: multipart('app.exe', 'application/x-msdownload', 'MZ'),
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ message: string }>().message).toContain('Tipo de arquivo não permitido');
  });

  it('FR-009: mensagem longa e excesso de mensagens por endereço são recusados', async () => {
    const credentialId = (
      await strictEditor.call('POST', `/projects/${strictProject.id}/credentials`, {
        name: 'Basic limites',
        type: 'webhookBasicAuth',
        data: { user: 'l', password: 'p' },
      })
    ).json<CredentialSummary>().id;
    const def: WorkflowDefinition = {
      nodes: [chatNode({ public: true, authentication: 'basicAuth' }, { credentialId })],
      edges: [],
      settings: {},
    };
    await publish(strictEditor, strictProject.id, def);
    const id = webhookIdOf(def);
    const auth = { authorization: `Basic ${Buffer.from('l:p').toString('base64')}` };
    const long = await post(strict, id, { sessionId: 'l', chatInput: 'x'.repeat(51) }, auth);
    expect(long.statusCode).toBe(413);
    const empty = await post(strict, id, { sessionId: 'l', chatInput: '  ' }, auth);
    expect(empty.statusCode).toBe(400);
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await post(strict, id, { sessionId: 'l', chatInput: 'oi' }, auth)).statusCode);
    }
    // O limite (4 por minuto) inclui as duas recusadas acima.
    expect(codes).toEqual([200, 200, 429]);
  });
});

describe('spec 027 — chat em streaming', () => {
  it('FR-005/FR-002: a API do chat responde com os passos (nome dos nós) e a resposta do último nó no fim', async () => {
    const trigger = chatNode({ public: true, options: { responseMode: 'streaming' } });
    const def = await chatAgent(editor, project.id, trigger);
    const { status } = await publish(editor, project.id, def);
    expect(status).toBe(200);
    const id = webhookIdOf(def);

    const page = await ctx.app.inject({ method: 'GET', url: `/webhook/${id}/chat` });
    expect(page.json<ChatConfig>().streaming).toBe(true);

    const answer = await post(ctx, id, {
      action: 'sendMessage',
      sessionId: 's-1',
      chatInput: 'Oi',
    });
    expect(answer.statusCode).toBe(200);
    expect(answer.headers['content-type']).toBe('application/json; charset=utf-8');
    const events = answer.body
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as StreamEvent)
      .filter((e) => e.type !== 'ping');
    const agent = def.nodes.find((n) => n.type === 'ai.agent')?.name;
    expect(
      events.map((e) =>
        e.type === 'begin' || e.type === 'end' ? `${e.type}:${e.metadata.nodeName}` : e.type,
      ),
    ).toEqual([
      'execution',
      'execution',
      'begin:Chat',
      'end:Chat',
      `begin:${String(agent)}`,
      `end:${String(agent)}`,
      'item',
    ]);
    const final = events.at(-1);
    expect(final).toMatchObject({ type: 'item', metadata: { nodeName: agent, final: true } });
    expect((final as { content: { output: string } }).content.output).toContain('Recebi: Oi');
  });
});

describe('spec 021 — mensagens da mesma sessão em sequência', () => {
  it('SC-006/FR-014: mesma sessão espera a anterior; sessões diferentes rodam juntas', async () => {
    const def: WorkflowDefinition = {
      nodes: [chatNode({ public: true }), delayNode('espera', server.base, 400)],
      edges: [edge('chat', 'espera')],
      settings: {},
    };
    const { wf } = await publish(editor, project.id, def);
    const id = webhookIdOf(def);
    const send = (sessionId: string) =>
      post(ctx, id, { action: 'sendMessage', sessionId, chatInput: 'oi' });

    const same = await Promise.all([send('mesma'), send('mesma')]);
    expect(same.map((r) => r.statusCode)).toEqual([200, 200]);
    const different = await Promise.all([send('s-a'), send('s-b')]);
    expect(different.map((r) => r.statusCode)).toEqual([200, 200]);

    // A execução seguinte da mesma sessão só começa depois que a anterior termina; as de sessões
    // diferentes se sobrepõem.
    const runs = (await executionsOf(editor, wf.id))
      .map((e) => ({ start: Date.parse(e.startedAt), end: Date.parse(e.finishedAt ?? '') }))
      .sort((a, b) => a.start - b.start);
    expect(runs).toHaveLength(4);
    const [a, b, c, d] = runs as [Run, Run, Run, Run];
    expect(b.start).toBeGreaterThanOrEqual(a.end);
    expect(d.start).toBeLessThan(c.end);
  });

  it('FR-014: quem espera a vez além do tempo limite é recusado como conversa ocupada', async () => {
    const credentialId = (
      await strictEditor.call('POST', `/projects/${strictProject.id}/credentials`, {
        name: 'Basic ocupada',
        type: 'webhookBasicAuth',
        data: { user: 'o', password: 'p' },
      })
    ).json<CredentialSummary>().id;
    const def: WorkflowDefinition = {
      nodes: [
        chatNode({ public: true, authentication: 'basicAuth' }, { credentialId }),
        delayNode('demorado', server.base, 4000),
      ],
      edges: [edge('chat', 'demorado')],
      settings: {},
    };
    await publish(strictEditor, strictProject.id, def);
    const id = webhookIdOf(def);
    const auth = { authorization: `Basic ${Buffer.from('o:p').toString('base64')}` };
    const message = { action: 'sendMessage', sessionId: 'ocupada', chatInput: 'oi' };
    const later = (ms: number) =>
      new Promise((r) => setTimeout(r, ms)).then(() => post(strict, id, message, auth));
    // A 1ª segura a vez até o tempo limite (1,5 s); das duas que chegam depois, uma pega a vez
    // liberada e a outra não a consegue dentro do próprio tempo limite.
    const [first, second, third] = await Promise.all([
      post(strict, id, message, auth),
      later(500),
      later(600),
    ]);
    expect(first.statusCode).toBe(504);
    expect([second.statusCode, third.statusCode].sort()).toEqual([409, 504]);
    const busy = second.statusCode === 409 ? second : third;
    expect(busy.json<{ message: string }>().message).toContain('conversa ainda está respondendo');
  });
});
