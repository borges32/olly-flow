/**
 * Prepara o teste de carga (spec 006, NFR-002): projeto, cota, credencial Postgres, tabela e os
 * workflows publicados `carga-recebido` (onReceived) e `carga-sincrono` (lastNode):
 * Webhook → HTTP (mock) → INSERT. Usa a API do compose (profile `app` + `load`).
 *   pnpm exec tsx infra/load/setup.ts
 */
const API = process.env.API_URL ?? 'http://localhost:3000';
const ISSUER = process.env.OIDC_ISSUER_URL ?? 'http://localhost:8080/realms/olly';

async function token(): Promise<string> {
  const res = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'olly-web',
      username: 'admin@olly.local',
      password: 'olly123',
      scope: 'openid',
    }),
  });
  if (!res.ok) throw new Error(`login: ${String(res.status)}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const auth = await token();
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${String(res.status)} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

await call('GET', '/me');
const project = await call<{ id: string }>('POST', '/projects', { name: `Carga k6 ${Date.now()}` });
// A cota padrão (20) limitaria a carga; o teste mede a fila e os workers.
await call('PUT', `/projects/${project.id}/quota`, { maxConcurrentExecutions: 500 });
const credential = await call<{ id: string }>('POST', `/projects/${project.id}/credentials`, {
  name: 'Banco da carga',
  type: 'postgres',
  data: {
    host: 'postgres',
    port: 5432,
    database: process.env.POSTGRES_DB ?? 'olly',
    user: process.env.POSTGRES_USER ?? 'olly',
    password: process.env.POSTGRES_PASSWORD ?? 'olly',
  },
});

const node = (id: string, type: string, params: Record<string, unknown>, extra = {}) => ({
  id,
  type,
  name: id,
  params,
  position: [0, 0],
  ...extra,
});
const edges = (ids: string[]) =>
  ids
    .slice(1)
    .map((to, i) => ({ id: `e${i}`, from: ids[i], fromPort: 'main', to, toPort: 'main' }));

// Tabela de destino, criada por uma execução de teste.
const ddl = await call<{ id: string }>('POST', `/projects/${project.id}/workflows`, {
  name: 'Carga: tabela',
  definition: {
    nodes: [
      node('m', 'trigger.manual', {}),
      node(
        'q',
        'postgres.query',
        {
          query:
            'CREATE TABLE IF NOT EXISTS load_events (id BIGSERIAL PRIMARY KEY, payload JSONB, created_at TIMESTAMPTZ DEFAULT now())',
        },
        { credentialId: credential.id },
      ),
    ],
    edges: edges(['m', 'q']),
    settings: {},
  },
});
const run = await call<{ executionId: string }>('POST', `/workflows/${ddl.id}/test-run`, {
  definition: (await call<{ definition: unknown }>('GET', `/workflows/${ddl.id}`)).definition,
});
for (let i = 0; i < 100; i++) {
  const d = await call<{ status: string }>('GET', `/executions/${run.executionId}`);
  if (d.status === 'success') break;
  if (d.status === 'error') throw new Error('falha ao criar a tabela load_events');
  await new Promise((r) => setTimeout(r, 200));
}

for (const [path, responseMode] of [
  ['carga-recebido', 'onReceived'],
  ['carga-sincrono', 'lastNode'],
] as const) {
  const wf = await call<{ id: string }>('POST', `/projects/${project.id}/workflows`, {
    name: `Carga: ${responseMode}`,
    definition: {
      nodes: [
        node('w', 'trigger.webhook', { httpMethod: 'POST', path, responseMode }),
        node('h', 'http.request', { method: 'GET', url: 'http://mock/' }),
        node(
          'i',
          'postgres.query',
          {
            query: 'INSERT INTO load_events (payload) VALUES ($1) RETURNING id',
            queryParameters: [{ value: "={{ JSON.stringify($('w').item.json.body) }}" }],
          },
          { credentialId: credential.id },
        ),
      ],
      edges: edges(['w', 'h', 'i']),
      settings: {},
    },
  });
  await call('POST', `/workflows/${wf.id}/publish`, { message: 'Publicação de teste' });
  console.log(`publicado: POST ${API}/webhook/${path} (${responseMode})`);
}
console.log(`PROJECT_ID=${project.id}`);
