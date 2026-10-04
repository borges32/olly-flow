import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import type {
  CredentialSummary,
  ExecutionDetail,
  TestRunResponse,
  WorkflowDefinition,
} from '@olly/shared-types';
import { ApiSession, DB, createProject, createWorkflow, loginViaUi } from './support';

let server: Server;
let base: string;
let admin: ApiSession;
let editor: ApiSession;
let projectId: string;
const table = `e2e_clientes_${Date.now()}`;

/** Roda SQL no banco "externo" por uma execução de teste via API (sem cliente Postgres no E2E). */
async function runSql(credentialId: string, query: string): Promise<void> {
  const wf = await createWorkflow(editor, projectId, `SQL ${Math.random()}`);
  const definition: WorkflowDefinition = {
    nodes: [
      { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
      {
        id: 'q',
        type: 'postgres.query',
        name: 'SQL',
        params: { query },
        credentialId,
        position: [200, 0],
      },
    ],
    edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'q', toPort: 'main' }],
    settings: {},
  };
  const { body } = await editor.call('POST', `/workflows/${wf.id}/test-run`, { definition });
  const { executionId } = body as TestRunResponse;
  await expect
    .poll(
      async () =>
        ((await editor.call('GET', `/executions/${executionId}`)).body as ExecutionDetail).status,
    )
    .toBe('success');
}

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify([
        { nome: 'Ana', cidade: 'Recife' },
        { nome: 'Bruno', cidade: 'Olinda' },
      ]),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({
    admin,
    project: { id: projectId },
  } = await createProject({ editor: 'editor' }));
  editor = await ApiSession.login('editor');
});
test.afterAll(async () => {
  server.close();
  const list = (await editor.call('GET', `/projects/${projectId}/credentials`))
    .body as CredentialSummary[];
  const pg = list.find((c) => c.type === 'postgres');
  if (pg) await runSql(pg.id, `DROP TABLE IF EXISTS ${table}`);
  await editor.dispose();
  await admin.dispose();
});

const status = (page: Page, name: string) =>
  page.getByTestId(`node-${name}`).getByTestId('node-status');

test.describe('spec 004 — integrações pelo editor', () => {
  test('SC-001/FR-004/FR-005/FR-016: Manual → HTTP → Postgres Insert → Postgres Query', async ({
    page,
  }) => {
    // HU-1: credencial criada e testada pela tela, sem o segredo voltar.
    await loginViaUi(page, 'editor', `/credentials?project=${projectId}`);
    await page.getByRole('button', { name: 'Nova credencial' }).click();
    const form = page.getByTestId('credential-form');
    await form.getByLabel('Nome').fill('PG E2E');
    await form.getByLabel('Tipo').selectOption('postgres');
    await form.getByLabel('Host *').fill(DB.host);
    await form.getByLabel('Porta').fill(String(DB.port));
    await form.getByLabel('Banco *').fill(DB.database);
    await form.getByLabel('Usuário *').fill(DB.user);
    await form.getByLabel('Senha *').fill(DB.password);
    await form.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Credencial criada')).toBeVisible();
    await page.getByRole('button', { name: 'Testar PG E2E' }).click();
    await page.getByRole('button', { name: 'Testar', exact: true }).click();
    await expect(page.getByTestId('credential-test-result')).toHaveText('Conexão bem-sucedida');
    await page.keyboard.press('Escape');
    // Ao editar, a senha não volta: campo vazio com aviso de que o valor é mantido.
    await page.getByRole('button', { name: 'Editar PG E2E' }).click();
    await expect(page.getByLabel('Senha')).toHaveValue('');
    await expect(page.getByLabel('Senha')).toHaveAttribute(
      'placeholder',
      /deixe em branco para manter/,
    );
    await page.keyboard.press('Escape');

    const credentials = (await editor.call('GET', `/projects/${projectId}/credentials`))
      .body as CredentialSummary[];
    const credentialId = credentials.find((c) => c.name === 'PG E2E')?.id ?? '';
    expect(credentials.find((c) => c.id === credentialId)?.publicFields).not.toHaveProperty(
      'password',
    );
    await runSql(
      credentialId,
      `CREATE TABLE ${table} (id serial PRIMARY KEY, nome text NOT NULL, cidade text)`,
    );

    const wf = await createWorkflow(editor, projectId, 'Integrações', {
      nodes: [
        { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
        {
          id: 'h',
          type: 'http.request',
          name: 'Buscar clientes',
          params: { url: `${base}/clientes` },
          position: [260, 0],
        },
        {
          id: 'w',
          type: 'postgres.write',
          name: 'Gravar',
          params: { operation: 'insert', schema: 'public', table: '', options: { returning: '' } },
          position: [520, 0],
        },
        {
          id: 'q',
          type: 'postgres.query',
          name: 'Consultar',
          params: { query: `SELECT nome, cidade FROM ${table} ORDER BY id`, mode: 'once' },
          position: [780, 0],
        },
      ],
      edges: [
        { id: 'e1', from: 'm', fromPort: 'main', to: 'h', toPort: 'main' },
        { id: 'e2', from: 'h', fromPort: 'main', to: 'w', toPort: 'main' },
        { id: 'e3', from: 'w', fromPort: 'main', to: 'q', toPort: 'main' },
      ],
      settings: {},
    });

    await page.goto(`/workflows/${wf.id}`);
    // Gravar: credencial e tabela escolhidas em listas carregadas do banco (FR-016).
    await page.getByTestId('node-Gravar').dblclick();
    await page.getByLabel('Credencial').selectOption({ label: 'PG E2E (postgres)' });
    const tableSelect = page.getByTestId('param-table');
    await expect(tableSelect.locator(`option[value="${table}"]`)).toHaveCount(1);
    await tableSelect.selectOption(table);
    await page.keyboard.press('Escape');
    // Consultar: SQL não oferece modo expressão (FR-012).
    await page.getByTestId('node-Consultar').dblclick();
    await page.getByLabel('Credencial').selectOption({ label: 'PG E2E (postgres)' });
    await expect(page.getByTestId('param-query-mode')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+s');
    await expect(page.getByText('Workflow salvo')).toBeVisible();

    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(status(page, 'Buscar clientes')).toHaveText(/2 itens/);
    await expect(status(page, 'Gravar')).toHaveAttribute('data-status', 'success');
    await expect(status(page, 'Consultar')).toHaveText(/2 itens/);
    await page.getByTestId('node-Consultar').dblclick();
    const output = page.getByTestId('ndv-output');
    await expect(output.getByRole('cell', { name: 'Ana' })).toBeVisible();
    await expect(output.getByRole('cell', { name: 'Olinda' })).toBeVisible();
  });

  test('FR-008/HU-2.2: URL da rede interna não liberada é bloqueada com mensagem clara', async ({
    page,
  }) => {
    const wf = await createWorkflow(editor, projectId, 'SSRF', {
      nodes: [
        { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
        {
          id: 'h',
          type: 'http.request',
          name: 'Metadados',
          params: { url: 'http://169.254.169.254/latest/meta-data' },
          position: [260, 0],
        },
      ],
      edges: [{ id: 'e1', from: 'm', fromPort: 'main', to: 'h', toPort: 'main' }],
      settings: {},
    });
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(status(page, 'Metadados')).toHaveAttribute('data-status', 'error');
    await page.getByTestId('node-Metadados').dblclick();
    await expect(page.getByTestId('ndv-output')).toContainText(
      'Destino bloqueado pelo filtro de rede (169.254.169.254)',
    );
  });

  test('FR-017: aba Configurações grava retry, timeout e comportamento em erro', async ({
    page,
  }) => {
    const wf = await createWorkflow(editor, projectId, 'Configurações', {
      nodes: [
        { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
        {
          id: 'h',
          type: 'http.request',
          name: 'API',
          params: { url: `${base}/x` },
          position: [260, 0],
        },
      ],
      edges: [{ id: 'e1', from: 'm', fromPort: 'main', to: 'h', toPort: 'main' }],
      settings: {},
    });
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByTestId('node-API').dblclick();
    await page.getByRole('tab', { name: 'Configurações' }).click();
    await page.getByTestId('settings-retry').check();
    await page.getByTestId('settings-timeout').fill('5000');
    await page.getByTestId('settings-on-error').selectOption('continue');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Workflow salvo')).toBeVisible();
    const saved = (await editor.call('GET', `/workflows/${wf.id}`)).body as {
      definition: WorkflowDefinition;
    };
    expect(saved.definition.nodes.find((n) => n.id === 'h')?.settings).toEqual({
      retry: { maxTries: 3, waitMs: 1000, backoff: 'fixed' },
      timeoutMs: 5000,
      onError: 'continue',
    });
  });
});
