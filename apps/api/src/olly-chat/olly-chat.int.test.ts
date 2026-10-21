import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ReadableStream, ReadableStreamReadResult } from 'node:stream/web';
import type {
  OllyChatConfig,
  OllyChatMessage,
  OllyChatPayload,
  OllyChatSession,
  StreamEvent,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

/**
 * Spec 028 (T011, T022): Olly Chat com um webhook falso que captura o payload e responde em
 * streaming (formato da spec 027), de uma vez (JSON), com erro, com limite atingido ou devagar.
 */
let ctx: TestContext;
let base: string;
let admin: TestUser, ana: TestUser, bruno: TestUser;
let hook: Server;
let hookBase: string;
const received: { path: string; payload: OllyChatPayload; headers: IncomingMessage['headers'] }[] =
  [];

const line = (e: unknown) => `${JSON.stringify(e)}\n`;
const meta = (extra: Record<string, unknown> = {}) => ({
  executionId: '11111111-1111-4111-8111-111111111111',
  timestamp: Date.now(),
  ...extra,
});

beforeAll(async () => {
  hook = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as OllyChatPayload;
      const path = req.url ?? '/';
      received.push({ path, payload, headers: req.headers });
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
      if (path === '/stream' || path === '/slow') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        const node = { nodeId: 'p', nodeName: 'Planner', nodeType: 'ai.agentix', runIndex: 0 };
        res.write(line({ type: 'execution', metadata: meta({ status: 'started' }) }));
        res.write(line({ type: 'begin', metadata: meta({ ...node, itemIndex: 0 }) }));
        await pause(path === '/slow' ? 1500 : 100);
        res.write(
          line({
            type: 'end',
            metadata: meta({ ...node, itemIndex: 0, status: 'success', durationMs: 100 }),
          }),
        );
        res.end(
          line({
            type: 'item',
            content: { output: `## Análise\n\nSobre: ${payload.message}` },
            metadata: meta({ final: true }),
          }),
        );
        return;
      }
      // Formato do workflow do assistente (21/10/2026): o texto vem no campo `report`.
      if (path === '/report') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(
          line({
            type: 'item',
            content: [
              {
                client: 'chat-olly',
                report: '## Mobile PF\n\n```mermaid\nflowchart LR\n  A[App] --> B[API]\n```',
                memoria: { resumo: 'x' },
              },
            ],
            metadata: meta({ final: true }),
          }),
        );
        return;
      }
      if (path === '/report-texto') {
        // Responder ao Webhook em "Texto": o item final traz o JSON serializado.
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(
          line({
            type: 'item',
            content: JSON.stringify(
              [
                {
                  client: 'chat-olly',
                  origem: 'orquestrador',
                  report: '**Registro:** P-1',
                  memoria: {},
                },
              ],
              null,
              2,
            ),
            metadata: meta({ final: true }),
          }),
        );
        return;
      }
      if (path === '/json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ output: 'Resposta de uma vez' }));
        return;
      }
      if (path === '/limit') {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ message: 'Limite de streams simultâneos do projeto atingido (1)' }),
        );
        return;
      }
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'O workflow terminou com erro' }));
    })();
  });
  await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
  hookBase = `http://127.0.0.1:${String((hook.address() as AddressInfo).port)}`;
  ctx = await startTestContext(
    { http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 } },
    { worker: false },
  );
  base = await ctx.listen();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@olly.local', groups: ['admin'] });
  // Usuários sem projeto (qualquer perfil acessa o chat). Ana vem do IdP com nome de usuário.
  ana = await loginAs(ctx, {
    sub: 'ana',
    email: 'ana@olly.local',
    name: 'ANA SOUZA',
    preferred_username: 'f123456',
  });
  bruno = await loginAs(ctx, { sub: 'bruno', email: 'bruno@olly.local', name: 'Bruno' });
}, 240_000);
afterAll(async () => {
  await ctx.close();
  hook.close();
});

const configure = (path: string, extra: Record<string, unknown> = {}) =>
  admin.call('PUT', '/admin/olly-chat', {
    webhookUrl: `${hookBase}${path}`,
    retentionDays: 7,
    authType: 'none',
    ...extra,
  });
const newSession = async (user: TestUser) =>
  (await user.call('POST', '/olly-chat/sessions')).json<OllyChatSession>();

/** Envia pela API real (HTTP), lendo o NDJSON até o fim (ou abortando depois do 1º evento). */
async function send(
  user: TestUser,
  sessionId: string,
  message: string,
  options: { abortAfterFirst?: boolean } = {},
): Promise<{ status: number; events: StreamEvent[]; body?: unknown }> {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/v1/olly-chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${user.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: controller.signal,
  });
  if (res.status !== 200 || !res.body)
    return { status: res.status, events: [], body: await res.json() };
  const events: StreamEvent[] = [];
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const l of lines.filter(Boolean)) {
        events.push(JSON.parse(l) as StreamEvent);
        if (options.abortAfterFirst) {
          controller.abort();
          return { status: 200, events };
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }
  return { status: 200, events };
}
const messagesOf = async (user: TestUser, sessionId: string) =>
  (await user.call('GET', `/olly-chat/sessions/${sessionId}/messages`)).json<OllyChatMessage[]>();

describe('spec 028 — configuração do Olly Chat', () => {
  it('FR-008/SC-004: só a administração configura; segredos não voltam nem vão para a auditoria', async () => {
    // Sem configuração: o chat avisa.
    expect((await ana.call('GET', '/olly-chat/status')).json()).toEqual({ configured: false });
    expect((await ana.call('GET', '/admin/olly-chat')).statusCode).toBe(403);
    expect((await ana.call('PUT', '/admin/olly-chat', {})).statusCode).toBe(403);
    const invalid = await admin.call('PUT', '/admin/olly-chat', {
      webhookUrl: 'ftp://x',
      retentionDays: 0,
      authType: 'none',
    });
    expect(invalid.statusCode).toBe(400);

    const saved = await configure('/stream', {
      authType: 'headerAuth',
      headerName: 'x-chave',
      headerValue: 'segredo-do-chat',
    });
    expect(saved.statusCode).toBe(200);
    const config = saved.json<OllyChatConfig>();
    expect(config).toMatchObject({
      webhookUrl: `${hookBase}/stream`,
      retentionDays: 7,
      authType: 'headerAuth',
      headerName: 'x-chave',
      hasSecret: true,
    });
    expect(saved.body).not.toContain('segredo-do-chat');
    // Segredo vazio mantém o guardado.
    expect(
      (
        await configure('/stream', { authType: 'headerAuth', headerName: 'x-chave' })
      ).json<OllyChatConfig>().hasSecret,
    ).toBe(true);
    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select('details')
      .where('action', '=', 'olly_chat.config')
      .execute();
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain('segredo-do-chat');
    expect((await ana.call('GET', '/olly-chat/status')).json()).toEqual({ configured: true });

    // A autenticação vai para o webhook.
    const session = await newSession(ana);
    await send(ana, session.id, 'teste da chave');
    expect(received.at(-1)?.headers['x-chave']).toBe('segredo-do-chat');
    await configure('/stream');
  });
});

describe('spec 028 — sessões e mensagens', () => {
  it('FR-003/FR-004/FR-005/FR-006/SC-001: payload com a identidade do servidor, passos e resposta guardada', async () => {
    await configure('/stream');
    const first = await newSession(ana);
    const r = await send(ana, first.id, 'Analise se estamos com algum problema com o mobile pf');
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.type)).toEqual(['execution', 'begin', 'end', 'item']);
    expect(r.events[1]).toMatchObject({ metadata: { nodeName: 'Planner' } });
    expect(received.at(-1)?.payload).toEqual({
      chatSessionId: String(first.number),
      client: 'chat-olly',
      email: 'ana@olly.local',
      // FR-004: o nome de usuário do IdP tem prioridade sobre o e-mail.
      login: 'f123456',
      name: 'ANA SOUZA',
      message: 'Analise se estamos com algum problema com o mobile pf',
    });
    const messages = await messagesOf(ana, first.id);
    expect(messages.map((m) => [m.role, m.text, m.pending])).toEqual([
      ['user', 'Analise se estamos com algum problema com o mobile pf', false],
      [
        'assistant',
        '## Análise\n\nSobre: Analise se estamos com algum problema com o mobile pf',
        false,
      ],
    ]);
    expect(messages[1]?.executionId).toBe('11111111-1111-4111-8111-111111111111');
    // Título automático com o começo da primeira mensagem.
    const [listed] = (await ana.call('GET', '/olly-chat/sessions')).json<OllyChatSession[]>();
    expect(listed?.title).toBe(
      `Sessão ${String(first.number)} · ${'Analise se estamos com algum problema com o mobile pf'.slice(0, 40)}`,
    );

    // FR-004: a página não consegue trocar a identidade (campos extras são ignorados).
    await fetch(`${base}/api/v1/olly-chat/sessions/${first.id}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ana.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'oi', email: 'outro@x.br', login: 'outro', name: 'Outro' }),
    }).then((res) => res.text());
    expect(received.at(-1)?.payload).toMatchObject({ email: 'ana@olly.local', login: 'f123456' });

    // Sem nome de usuário do IdP, o login é o e-mail.
    const b = await newSession(bruno);
    await send(bruno, b.id, 'oi');
    expect(received.at(-1)?.payload).toMatchObject({ login: 'bruno@olly.local', name: 'Bruno' });
  });

  it('FR-003/SC-002: numeração por usuário sem reaproveitar; outro usuário não vê nem mexe', async () => {
    const carla = await loginAs(ctx, { sub: 'carla', email: 'carla@olly.local' });
    const one = await newSession(carla);
    const two = await newSession(carla);
    expect([one.number, two.number]).toEqual([1, 2]);
    // Excluir não libera o número.
    expect((await carla.call('DELETE', `/olly-chat/sessions/${two.id}`)).statusCode).toBe(204);
    expect((await newSession(carla)).number).toBe(3);
    // Cada usuário tem a sua "sessão 1".
    const daniel = await loginAs(ctx, { sub: 'daniel', email: 'daniel@olly.local' });
    expect((await newSession(daniel)).number).toBe(1);

    expect((await daniel.call('GET', `/olly-chat/sessions/${one.id}/messages`)).statusCode).toBe(
      404,
    );
    expect(
      (await daniel.call('PATCH', `/olly-chat/sessions/${one.id}`, { title: 'x' })).statusCode,
    ).toBe(404);
    expect((await daniel.call('DELETE', `/olly-chat/sessions/${one.id}`)).statusCode).toBe(404);
    expect((await send(daniel, one.id, 'oi')).status).toBe(404);
    const list = (await daniel.call('GET', '/olly-chat/sessions')).json<OllyChatSession[]>();
    expect(list.map((s) => s.id)).not.toContain(one.id);

    // Renomear (o título personalizado não é trocado pela primeira mensagem).
    expect(
      (await carla.call('PATCH', `/olly-chat/sessions/${one.id}`, { title: 'Mobile PF' }))
        .statusCode,
    ).toBe(204);
    await send(carla, one.id, 'primeira mensagem');
    const titles = (await carla.call('GET', '/olly-chat/sessions')).json<OllyChatSession[]>();
    expect(titles.find((s) => s.id === one.id)?.title).toBe('Mobile PF');
  });

  it('FR-007: uma mensagem por vez na sessão; a resposta é guardada mesmo com o navegador fechado', async () => {
    await configure('/slow');
    const session = await newSession(ana);
    const first = await send(ana, session.id, 'pergunta demorada', { abortAfterFirst: true });
    expect(first.events[0]?.type).toBe('execution');
    // A sessão está respondendo: a segunda mensagem é recusada.
    const busy = await send(ana, session.id, 'outra');
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({
      error: { message: 'A sessão ainda está respondendo a mensagem anterior' },
    });
    expect(
      (await ana.call('GET', '/olly-chat/sessions'))
        .json<OllyChatSession[]>()
        .find((s) => s.id === session.id)?.busy,
    ).toBe(true);
    // O navegador fechou, mas a API terminou de ler e guardou a resposta.
    await expect
      .poll(async () => (await messagesOf(ana, session.id)).at(-1)?.pending, { timeout: 10_000 })
      .toBe(false);
    expect((await messagesOf(ana, session.id)).at(-1)).toMatchObject({
      role: 'assistant',
      text: '## Análise\n\nSobre: pergunta demorada',
    });
    await configure('/stream');
  });

  it('FR-005 (21/10/2026): o texto guardado é o campo report do JSON final (lista)', async () => {
    await configure('/report');
    const session = await newSession(ana);
    const r = await send(ana, session.id, 'Como está o mobile pf?');
    expect(r.events.at(-1)).toMatchObject({ type: 'item' });
    expect((await messagesOf(ana, session.id)).at(-1)).toMatchObject({
      role: 'assistant',
      text: '## Mobile PF\n\n```mermaid\nflowchart LR\n  A[App] --> B[API]\n```',
    });
    await configure('/stream');
  });

  it('FR-005 (correção 21/10/2026): o JSON final que chega como texto também tem o report lido', async () => {
    await configure('/report-texto');
    const session = await newSession(ana);
    await send(ana, session.id, 'Falhas no cronjob?');
    expect((await messagesOf(ana, session.id)).at(-1)).toMatchObject({
      role: 'assistant',
      text: '**Registro:** P-1',
    });
    await configure('/stream');
  });

  it('FR-005/FR-010: resposta de uma vez, erro do workflow, limite de streams e filtro de rede', async () => {
    const session = await newSession(bruno);
    await configure('/json');
    const json = await send(bruno, session.id, 'oi');
    expect(json.events).toEqual([
      expect.objectContaining({ type: 'item', content: { output: 'Resposta de uma vez' } }),
    ]);
    await configure('/erro');
    expect((await send(bruno, session.id, 'oi')).events.at(-1)).toMatchObject({
      type: 'error',
      content: 'O assistente recusou a mensagem (HTTP 500): O workflow terminou com erro',
    });
    await configure('/limit');
    expect((await send(bruno, session.id, 'oi')).events.at(-1)).toMatchObject({
      type: 'error',
      content: expect.stringContaining(
        'Limite de streams simultâneos do projeto atingido',
      ) as string,
    });
    // Destino interno fora da allowlist: o filtro de rede bloqueia.
    await admin.call('PUT', '/admin/olly-chat', {
      webhookUrl: 'http://10.0.0.1/webhook/assistente',
      retentionDays: 7,
      authType: 'none',
    });
    expect((await send(bruno, session.id, 'oi')).events.at(-1)).toMatchObject({
      type: 'error',
      content: expect.stringContaining('filtro de rede') as string,
    });
    const roles = (await messagesOf(bruno, session.id)).map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'error', 'user', 'error', 'user', 'error']);
    await configure('/stream');
  });
});
