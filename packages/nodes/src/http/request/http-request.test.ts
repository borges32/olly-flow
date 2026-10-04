import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Item } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedCredential } from '../../credentials/definitions.js';
import { NodeExecutionError } from '../../errors.js';
import { createHttpGuard } from '../../shared/http-guard.js';
import { fakeContext } from '../../test-support/context.js';
import { OAuth2TokenCache } from '../auth.js';
import { executeHttpRequest, type HttpRequestDeps } from './execute.js';

let server: Server;
let base: string;
let tokenCalls = 0;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const body = await readBody(req);
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      switch (url.pathname) {
        case '/echo':
          json(200, {
            method: req.method,
            query: Object.fromEntries(url.searchParams),
            headers: req.headers,
            body,
          });
          return;
        case '/list':
          json(200, [{ id: 1 }, { id: 2 }]);
          return;
        case '/text':
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('olá');
          return;
        case '/bin':
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-disposition': 'attachment; filename="logo.png"',
          });
          res.end(PNG);
          return;
        case '/fail':
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end('falhou aqui');
          return;
        case '/slow':
          setTimeout(() => {
            json(200, { ok: true });
          }, 2000);
          return;
        case '/big':
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          res.end(Buffer.alloc(3 * 1024 * 1024));
          return;
        case '/redirect-interno':
          res.writeHead(302, { location: 'http://10.0.0.1/' });
          res.end();
          return;
        case '/token': {
          tokenCalls++;
          const expected = `Basic ${Buffer.from('cliente:segredo-oauth').toString('base64')}`;
          if (
            req.headers.authorization !== expected ||
            !body.includes('grant_type=client_credentials')
          ) {
            json(401, { error: 'invalid_client' });
            return;
          }
          json(200, { access_token: `tok-${tokenCalls}`, expires_in: 3600 });
          return;
        }
        default:
          json(404, { error: 'not found' });
      }
    })();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

const deps = (extra: Partial<HttpRequestDeps> = {}): HttpRequestDeps => ({
  guard: createHttpGuard({ allowlist: ['127.0.0.1'] }),
  oauth: new OAuth2TokenCache(),
  maxResponseBytes: 50 * 1024 * 1024,
  ...extra,
});
const cred = (type: string, data: Record<string, unknown>): ResolvedCredential => ({
  id: `c-${type}`,
  type,
  data,
  updatedAt: '2026-10-04T00:00:00.000Z',
});
const run = (
  params: Record<string, unknown> | Record<string, unknown>[],
  items: Item[] = [{ json: {} }],
  extra: { credential?: ResolvedCredential; deps?: HttpRequestDeps; onError?: 'continue' } = {},
) => {
  const ctx = fakeContext({
    params,
    ...(extra.credential && { credential: extra.credential }),
    ...(extra.onError && { node: { settings: { onError: extra.onError } } }),
  });
  return {
    ctx,
    out: executeHttpRequest({ inputs: { main: items }, items }, ctx, extra.deps ?? deps()),
  };
};
const jsonOf = async (p: Promise<{ main?: Item[] }>) => (await p).main?.map((i) => i.json) ?? [];

describe('spec 004 — FR-009: nó http.request', () => {
  it('FR-009/HU-2.1: GET com Bearer, query e headers; uma requisição por item', async () => {
    const items = [{ json: { id: 1 } }, { json: { id: 2 } }];
    const { out } = run(
      [1, 2].map((id) => ({
        url: `${base}/echo`,
        authentication: 'credential',
        queryParameters: [{ name: 'id', value: String(id) }],
        headers: [{ name: 'X-Origem', value: 'olly' }],
      })),
      items,
      { credential: cred('httpBearer', { token: 'tok-bearer' }) },
    );
    const result = (await out).main ?? [];
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
    expect(result[1]?.json).toMatchObject({
      method: 'GET',
      query: { id: '2' },
      headers: { authorization: 'Bearer tok-bearer', 'x-origem': 'olly' },
    });
  });

  it('FR-004/FR-009: Basic, header e query aplicam a credencial', async () => {
    const echo = async (credential: ResolvedCredential) =>
      (
        await jsonOf(
          run({ url: `${base}/echo`, authentication: 'credential' }, undefined, { credential }).out,
        )
      )[0] as {
        headers: Record<string, string>;
        query: Record<string, string>;
      };
    expect(
      (await echo(cred('httpBasic', { user: 'ana', password: 'pw' }))).headers.authorization,
    ).toBe(`Basic ${Buffer.from('ana:pw').toString('base64')}`);
    expect(
      (await echo(cred('httpHeaderAuth', { name: 'X-API-Key', value: 'k1' }))).headers['x-api-key'],
    ).toBe('k1');
    expect(
      (await echo(cred('httpQueryAuth', { name: 'api_key', value: 'q1' }))).query.api_key,
    ).toBe('q1');
  });

  it('FR-009: corpos JSON (texto ou objeto), form, raw e multipart com binário', async () => {
    const send = async (extra: Record<string, unknown>) =>
      (
        await jsonOf(run({ url: `${base}/echo`, method: 'POST', sendBody: true, ...extra }).out)
      )[0] as {
        headers: Record<string, string>;
        body: string;
      };
    const json = await send({ contentType: 'json', jsonBody: '{"a":1}' });
    expect(json.headers['content-type']).toBe('application/json');
    expect(JSON.parse(json.body)).toEqual({ a: 1 });
    expect(JSON.parse((await send({ contentType: 'json', jsonBody: { b: [1, 2] } })).body)).toEqual(
      { b: [1, 2] },
    );
    const form = await send({
      contentType: 'form-urlencoded',
      bodyParameters: [{ name: 'x', value: 'um dois' }],
    });
    expect(form.body).toBe('x=um+dois');
    const raw = await send({
      contentType: 'raw',
      rawBody: '<a/>',
      rawContentType: 'application/xml',
    });
    expect(raw).toMatchObject({ body: '<a/>', headers: { 'content-type': 'application/xml' } });

    const ctx = fakeContext({
      params: {
        url: `${base}/echo`,
        method: 'POST',
        sendBody: true,
        contentType: 'multipart',
        bodyParameters: [
          { name: 'campo', value: 'v' },
          { name: 'arquivo', value: 'data', parameterType: 'binary' },
        ],
      },
    });
    const ref = await ctx.helpers.putBinary(PNG, { mimeType: 'image/png', fileName: 'a.png' });
    const items = [{ json: {}, binary: { data: ref } }];
    const multipart = (await executeHttpRequest({ inputs: { main: items }, items }, ctx, deps()))
      .main?.[0]?.json as {
      headers: Record<string, string>;
      body: string;
    };
    expect(multipart.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(multipart.body).toContain('name="campo"');
    expect(multipart.body).toContain('filename="a.png"');
  });

  it('FR-009: lista JSON vira um item por elemento; texto vai para `data`; resposta completa', async () => {
    expect(await jsonOf(run({ url: `${base}/list` }).out)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(await jsonOf(run({ url: `${base}/text` }).out)).toEqual([{ data: 'olá' }]);
    const [full] = await jsonOf(run({ url: `${base}/text`, options: { fullResponse: true } }).out);
    expect(full).toMatchObject({
      statusCode: 200,
      body: 'olá',
      headers: { 'content-type': 'text/plain' },
    });
  });

  it('FR-010: resposta binária vai para o armazenamento e o item guarda só a referência', async () => {
    const { ctx, out } = run({ url: `${base}/bin` });
    const [item] = (await out).main ?? [];
    expect(item?.json).toEqual({});
    expect(item?.binary?.data).toMatchObject({
      mimeType: 'image/png',
      fileName: 'logo.png',
      size: PNG.length,
    });
    expect(Buffer.from(ctx.binaries.get(item?.binary?.data?.id ?? '') ?? [])).toEqual(PNG);
  });

  it('FR-009: status de erro falha com código e trecho do corpo; neverError devolve a resposta', async () => {
    const error = await run({ url: `${base}/fail` }).out.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NodeExecutionError);
    expect(error).toMatchObject({
      message: 'A requisição falhou com status 500',
      details: { httpCode: 500, description: 'falhou aqui' },
    });
    const ok = await jsonOf(
      run({ url: `${base}/fail`, options: { neverError: true, fullResponse: true } }).out,
    );
    expect(ok[0]).toMatchObject({ statusCode: 500, body: 'falhou aqui' });
  });

  it('FR-017: onError continue — item com erro vira { error } e os demais seguem', async () => {
    const out = await jsonOf(
      run([{ url: `${base}/fail` }, { url: `${base}/text` }], [{ json: {} }, { json: {} }], {
        onError: 'continue',
      }).out,
    );
    expect(out).toEqual([
      {
        error: {
          message: 'A requisição falhou com status 500',
          description: 'falhou aqui',
          httpCode: 500,
        },
      },
      { data: 'olá' },
    ]);
  });

  it('FR-018/NFR-001: timeout da requisição e limite de tamanho da resposta', async () => {
    await expect(run({ url: `${base}/slow`, options: { timeout: 100 } }).out).rejects.toThrow(
      'Tempo limite da requisição excedido (100 ms)',
    );
    await expect(
      run({ url: `${base}/big` }, undefined, { deps: deps({ maxResponseBytes: 1024 * 1024 }) }).out,
    ).rejects.toThrow('Resposta acima do limite de 1 MB');
  });

  it('FR-018: cancelar a execução aborta a requisição em andamento', async () => {
    const controller = new AbortController();
    const ctx = fakeContext({ params: { url: `${base}/slow` }, signal: controller.signal });
    const started = Date.now();
    const pending = executeHttpRequest({ inputs: {}, items: [] }, ctx, deps());
    setTimeout(() => {
      controller.abort(new Error('cancelado'));
    }, 50);
    await expect(pending).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('FR-008/HU-2.2: URL ou redirect para a rede interna é bloqueado com mensagem clara', async () => {
    await expect(run({ url: 'http://169.254.169.254/latest' }).out).rejects.toThrow(
      /Destino bloqueado pelo filtro de rede \(169\.254\.169\.254\)/,
    );
    await expect(run({ url: `${base}/redirect-interno` }).out).rejects.toThrow(/10\.0\.0\.1/);
    // Sem allowlist, nem o servidor local passa.
    await expect(
      run({ url: `${base}/echo` }, undefined, { deps: deps({ guard: createHttpGuard() }) }).out,
    ).rejects.toThrow(/loopback/);
  });

  it('FR-009: lotes enviam `batchSize` requisições por vez com intervalo entre lotes', async () => {
    const items = [1, 2, 3, 4].map((n) => ({ json: { n } }));
    const started = Date.now();
    const out = await jsonOf(
      run({ url: `${base}/text`, options: { batchSize: 2, batchIntervalMs: 150 } }, items).out,
    );
    expect(out).toHaveLength(4);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });
});

describe('spec 004 — FR-004/T031: OAuth2 client credentials', () => {
  it('FR-004: obtém o token, usa como Bearer, guarda em cache e registra como segredo', async () => {
    tokenCalls = 0;
    const credential = cred('oauth2ClientCredentials', {
      tokenUrl: `${base}/token`,
      clientId: 'cliente',
      clientSecret: 'segredo-oauth',
    });
    const d = deps();
    const first = run({ url: `${base}/echo`, authentication: 'credential' }, undefined, {
      credential,
      deps: d,
    });
    const [echo] = (await jsonOf(first.out)) as { headers: Record<string, string> }[];
    expect(echo?.headers.authorization).toBe('Bearer tok-1');
    expect(first.ctx.secrets).toContain('tok-1');
    await jsonOf(
      run({ url: `${base}/echo`, authentication: 'credential' }, undefined, { credential, deps: d })
        .out,
    );
    expect(tokenCalls).toBe(1);
    // Credencial alterada (updatedAt novo) não reaproveita o token.
    await jsonOf(
      run({ url: `${base}/echo`, authentication: 'credential' }, undefined, {
        credential: { ...credential, updatedAt: '2026-10-05T00:00:00.000Z' },
        deps: d,
      }).out,
    );
    expect(tokenCalls).toBe(2);
  });

  it('FR-004: token renovado 30 s antes de expirar', async () => {
    let now = 0;
    const cache = new OAuth2TokenCache(() => now);
    tokenCalls = 0;
    const credential = cred('oauth2ClientCredentials', {
      tokenUrl: `${base}/token`,
      clientId: 'cliente',
      clientSecret: 'segredo-oauth',
    });
    const guard = createHttpGuard({ allowlist: ['127.0.0.1'] });
    expect(await cache.getToken(credential, guard)).toBe('tok-1');
    now = (3600 - 31) * 1000;
    expect(await cache.getToken(credential, guard)).toBe('tok-1');
    now = (3600 - 29) * 1000;
    expect(await cache.getToken(credential, guard)).toBe('tok-2');
  });

  it('FR-003: erro do servidor de autorização não ecoa o corpo nem o segredo', async () => {
    const credential = cred('oauth2ClientCredentials', {
      tokenUrl: `${base}/token`,
      clientId: 'cliente',
      clientSecret: 'errado',
    });
    const error = await run({ url: `${base}/echo`, authentication: 'credential' }, undefined, {
      credential,
    }).out.catch((e: unknown) => e as Error);
    expect((error as Error).message).toBe('Não foi possível obter o token OAuth2 (status 401)');
    expect(JSON.stringify(error)).not.toContain('errado');
  });
});
