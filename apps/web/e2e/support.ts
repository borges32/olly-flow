import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { expect, request, type APIRequestContext, type Page } from '@playwright/test';
import type {
  MeResponse,
  ProjectSummary,
  RoleName,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const envFile = existsSync(`${root}/.env`) ? `${root}/.env` : `${root}/.env.example`;
const env = {
  ...(parseEnv(readFileSync(envFile, 'utf8')) as Record<string, string>),
  ...process.env,
};
const ISSUER = env.OIDC_ISSUER_URL ?? 'http://localhost:8080/realms/olly';
export const API_URL = `http://localhost:${env.API_PORT ?? '3000'}`;
export const PASSWORD = 'olly123';
/** Banco da plataforma no compose, usado como banco "externo" nos testes de integração (spec 004). */
export const DB = {
  host: 'localhost',
  port: 5432,
  database: env.POSTGRES_DB ?? 'olly',
  user: env.POSTGRES_USER ?? 'olly',
  password: env.POSTGRES_PASSWORD ?? 'olly',
};

export type TestUsername = 'admin' | 'editor' | 'executor' | 'viewer';

/** Sessão na API com token do IdP de desenvolvimento (password grant, só em dev). */
export class ApiSession {
  private constructor(
    private readonly ctx: APIRequestContext,
    readonly me: MeResponse,
  ) {}

  static async login(username: TestUsername): Promise<ApiSession> {
    const idp = await request.newContext();
    const res = await idp.post(`${ISSUER}/protocol/openid-connect/token`, {
      form: {
        grant_type: 'password',
        client_id: 'olly-web',
        username: `${username}@olly.local`,
        password: PASSWORD,
        scope: 'openid',
      },
    });
    expect(res.ok()).toBe(true);
    const { access_token: token } = (await res.json()) as { access_token: string };
    await idp.dispose();
    const ctx = await request.newContext({
      baseURL: `${API_URL}/api/v1/`,
      extraHTTPHeaders: { authorization: `Bearer ${token}` },
    });
    // /me também sincroniza o usuário na plataforma, permitindo adicioná-lo a projetos.
    const me = (await (await ctx.get('me')).json()) as MeResponse;
    return new ApiSession(ctx, me);
  }

  async call(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const res = await this.ctx.fetch(path.replace(/^\//, ''), {
      method,
      ...(data !== undefined && { data }),
    });
    const text = await res.text();
    return { status: res.status(), body: text ? (JSON.parse(text) as unknown) : undefined };
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

/** Cria um projeto exclusivo do teste com os membros pedidos. */
export async function createProject(
  members: Partial<Record<TestUsername, RoleName>>,
): Promise<{ project: ProjectSummary; admin: ApiSession }> {
  const admin = await ApiSession.login('admin');
  const created = await admin.call('POST', '/projects', {
    name: `E2E ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  });
  const project = created.body as ProjectSummary;
  for (const [username, role] of Object.entries(members)) {
    const user = await ApiSession.login(username as TestUsername);
    const res = await admin.call('PUT', `/projects/${project.id}/members/${user.me.id}`, { role });
    expect(res.status).toBe(200);
    await user.dispose();
  }
  return { project, admin };
}

export async function createWorkflow(
  session: ApiSession,
  projectId: string,
  name: string,
  definition?: WorkflowDefinition,
): Promise<WorkflowDetail> {
  const res = await session.call('POST', `/projects/${projectId}/workflows`, {
    name,
    definition,
  });
  expect(res.status).toBe(201);
  return res.body as WorkflowDetail;
}

export const manualSetDefinition: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Gatilho manual', params: {}, position: [0, 0] },
    {
      id: 's',
      type: 'data.set',
      name: 'Definir campos',
      params: {
        fields: [{ name: 'cliente.nome', type: 'string', value: 'Ana' }],
        keepOnlySet: false,
      },
      position: [300, 0],
    },
  ],
  edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 's', toPort: 'main' }],
  settings: {},
};

/** Login pela UI com um usuário de teste. */
export async function loginViaUi(page: Page, username: TestUsername, path = '/'): Promise<void> {
  await page.goto(path);
  await page.getByRole('button', { name: 'Entrar com conta institucional' }).click();
  await page.locator('#username').fill(`${username}@olly.local`);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#kc-login').click();
  await expect(page.getByTestId('user-name')).not.toBeEmpty();
}

/** Arrasta da saída de um nó para a entrada de outro. */
export async function connectNodes(page: Page, from: string, to: string): Promise<void> {
  const source = page.getByTestId(`node-${from}`).locator('.react-flow__handle.source');
  const target = page.getByTestId(`node-${to}`).locator('.react-flow__handle.target');
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  if (!a || !b) throw new Error('handles não encontrados');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}
