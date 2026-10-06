import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import type {
  CredentialSummary,
  ExecutionDetail,
  ProjectSummary,
  TestRunResponse,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

/**
 * SC-002 (T023): varredura com valores sentinela. Nenhum segredo, nem as formas derivadas
 * (Basic em base64, token OAuth2 obtido), pode aparecer nas respostas da API, nos logs ou no banco.
 */
const S = {
  bearer: 'sentinela-bearer-a1b2c3',
  basicPassword: 'sentinela-basic-d4e5f6',
  header: 'sentinela-header-g7h8i9',
  query: 'sentinela-query-j1k2l3',
  oauthSecret: 'sentinela-oauth-m4n5o6',
  oauthToken: 'sentinela-token-p7q8r9',
  pgPassword: 'sentinela-pg-s1t2u3',
};
const derived = [Buffer.from(`ana:${S.basicPassword}`).toString('base64')];
const ALL = [...Object.values(S), ...derived];

let ctx: TestContext;
let editor: TestUser;
let server: Server;
let base: string;
const logs: string[] = [];
const responses: string[] = [];

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

beforeAll(async () => {
  // API "indiscreta": ecoa cabeçalhos e query, e devolve o token no erro.
  server = createServer((req, res) => {
    void body(req).then((raw) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/token') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: S.oauthToken, expires_in: 3600 }));
        return;
      }
      const echo = { headers: req.headers, query: Object.fromEntries(url.searchParams), raw };
      res.writeHead(url.pathname === '/fail' ? 500 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(echo));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const logStream = new Writable({
    write(chunk: Buffer, _enc, done) {
      logs.push(chunk.toString('utf8'));
      done();
    },
  });
  ctx = await startTestContext(
    { logLevel: 'trace', http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 } },
    { logStream },
  );
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  const plain = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  editor = {
    ...plain,
    call: async (method, path, payload) => {
      const res = await plain.call(method, path, payload);
      responses.push(res.body);
      return res;
    },
  };
  const project = (
    await admin.call('POST', '/projects', { name: 'Vazamento' })
  ).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  await sql`CREATE ROLE leak_user LOGIN PASSWORD ${sql.lit(S.pgPassword)}`.execute(ctx.database.db);
  projectId = project.id;
});
afterAll(async () => {
  server.close();
  await ctx.close();
});

let projectId = '';

describe('spec 004 — SC-002/FR-002/FR-003: varredura de segredos', () => {
  it('SC-002: nenhum segredo nas respostas, nos logs ou no banco após usar todas as credenciais', async () => {
    const c = ctx.database.container;
    const definitions: [string, string, Record<string, unknown>][] = [
      ['Bearer', 'httpBearer', { token: S.bearer }],
      ['Basic', 'httpBasic', { user: 'ana', password: S.basicPassword }],
      ['Header', 'httpHeaderAuth', { name: 'X-Chave', value: S.header }],
      ['Query', 'httpQueryAuth', { name: 'chave', value: S.query }],
      [
        'OAuth2',
        'oauth2ClientCredentials',
        { tokenUrl: `${base}/token`, clientId: 'cliente', clientSecret: S.oauthSecret },
      ],
      [
        'PG',
        'postgres',
        {
          host: c.getHost(),
          port: c.getPort(),
          database: c.getDatabase(),
          user: 'leak_user',
          password: S.pgPassword,
        },
      ],
    ];
    const ids: Record<string, string> = {};
    for (const [name, type, data] of definitions) {
      const res = await editor.call('POST', `/projects/${projectId}/credentials`, {
        name,
        type,
        data,
      });
      expect(res.statusCode, name).toBe(201);
      ids[name] = res.json<CredentialSummary>().id;
    }
    await editor.call('GET', `/projects/${projectId}/credentials`);
    for (const id of Object.values(ids)) {
      await editor.call('GET', `/credentials/${id}`);
      await editor.call('PUT', `/credentials/${id}`, { data: {} });
      await editor.call('POST', `/credentials/${id}/test`, { url: `${base}/teste` });
    }
    // Erro do Postgres que poderia citar a conexão.
    await editor.call(
      'GET',
      `/credentials/${ids.PG ?? ''}/postgres/columns?schema=public&table=nao_existe`,
    );

    const http = (
      id: string,
      name: string,
      path = '/eco',
      extra: Partial<WorkflowDefinition['nodes'][number]> = {},
    ) => ({
      id,
      type: 'http.request',
      name,
      params: {
        url: `${base}${path}`,
        authentication: 'credential',
        method: 'POST',
        sendBody: true,
        jsonBody: '{"a":1}',
      },
      credentialId: ids[name.split(' ')[0] ?? ''],
      position: [0, 0] as [number, number],
      ...extra,
    });
    const nodes = [
      {
        id: 'm',
        type: 'trigger.manual',
        name: 'Início',
        params: {},
        position: [0, 0] as [number, number],
      },
      http('h1', 'Bearer'),
      http('h2', 'Basic'),
      http('h3', 'Header'),
      http('h4', 'Query'),
      http('h5', 'OAuth2'),
      http('h6', 'Bearer falha', '/fail', { settings: { onError: 'continue' } }),
      {
        id: 'p',
        type: 'postgres.query',
        name: 'PG',
        params: { query: 'SELECT current_user AS usuario' },
        credentialId: ids.PG,
        position: [0, 0] as [number, number],
      },
      {
        id: 'x',
        type: 'http.request',
        name: 'Bearer final',
        params: { url: `${base}/fail`, authentication: 'credential' },
        credentialId: ids.Bearer,
        position: [0, 0] as [number, number],
      },
    ];
    const chain = nodes.map((n) => n.id);
    const definition: WorkflowDefinition = {
      nodes,
      edges: chain.slice(1).map((to, i) => ({
        id: `e${i}`,
        from: chain[i] ?? '',
        fromPort: 'main',
        to,
        toPort: 'main',
      })),
      settings: {},
    };
    const wf = (
      await editor.call('POST', `/projects/${projectId}/workflows`, { name: 'Vaza?', definition })
    ).json<WorkflowDetail>();
    const { executionId } = (
      await editor.call('POST', `/workflows/${wf.id}/test-run`, { definition })
    ).json<TestRunResponse>();
    let detail: ExecutionDetail | undefined;
    for (let i = 0; i < 100 && detail?.status !== 'error'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      detail = (await editor.call('GET', `/executions/${executionId}`)).json<ExecutionDetail>();
    }
    // A execução usou de fato as credenciais (as respostas ecoaram, mascaradas). Desde a spec 009
    // o cabeçalho inteiro é ocultado pela regra padrão `*authorization*` (FR-016).
    expect(detail?.status).toBe('error');
    const byId = Object.fromEntries((detail?.nodes ?? []).map((n) => [n.nodeId, n]));
    expect(JSON.stringify(byId.h1?.output)).toContain('"authorization":"***"');
    expect(byId.p?.output?.main?.[0]?.json).toEqual({ usuario: 'leak_user' });
    expect(detail?.error?.message).toBe('A requisição falhou com status 500');

    const tables = await Promise.all(
      ['node_executions', 'executions', 'audit_log', 'workflow_versions', 'credentials'].map(
        async (t) => {
          const { rows } = await sql<
            Record<string, unknown>
          >`SELECT * FROM ${sql.table(t)}`.execute(ctx.database.db);
          return JSON.stringify(rows, (_k, v: unknown) =>
            // bytea: procura o texto do envelope (o conteúdo cifrado não pode conter o segredo).
            typeof v === 'object' && v !== null && (v as { type?: string }).type === 'Buffer'
              ? Buffer.from((v as { data: number[] }).data).toString('utf8')
              : v,
          );
        },
      ),
    );
    const haystacks = {
      respostas: responses.join('\n'),
      logs: logs.join(''),
      banco: tables.join('\n'),
    };
    expect(haystacks.logs.length).toBeGreaterThan(0);
    for (const [where, text] of Object.entries(haystacks)) {
      for (const secret of ALL) expect(text.includes(secret), `${secret} em ${where}`).toBe(false);
    }
  });
});
