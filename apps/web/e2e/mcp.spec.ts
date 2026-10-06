import { expect, test } from '@playwright/test';
import { startMcpTestServer, type McpTestServer } from '@olly/mcp-test-server';
import type {
  CredentialSummary,
  ExecutionDetail,
  McpServer,
  TestRunResponse,
  WorkflowDefinition,
} from '@olly/shared-types';
import { ApiSession, PASSWORD, createProject, createWorkflow, loginViaUi } from './support';

let mcp: McpTestServer;
let admin: ApiSession;
let editor: ApiSession;
let projectId: string;
const suffix = `${Date.now()}`;

/** Servidor aprovado com `soma` liberada (via API), para os cenários do editor. */
async function approvedServer(name: string): Promise<McpServer> {
  const created = await admin.call('POST', '/mcp-servers', {
    name,
    transport: 'streamableHttp',
    url: `${mcp.url}/mcp`,
  });
  expect(created.status).toBe(201);
  const server = created.body as McpServer;
  expect((await admin.call('POST', `/mcp-servers/${server.id}/approve`)).status).toBe(200);
  await admin.call('PUT', `/mcp-servers/${server.id}/policies`, {
    policies: [{ toolName: 'soma', allowed: true, destructive: false }],
  });
  return server;
}

const mcpDefinition = (
  serverId: string,
  params: Record<string, unknown> = {},
): WorkflowDefinition => ({
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'c',
      type: 'ai.mcpClient',
      name: 'MCP',
      params: { serverId, operation: 'callTool', argumentsMode: 'form', ...params },
      position: [300, 0],
    },
  ],
  edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'c', toPort: 'main' }],
  settings: {},
});

test.beforeAll(async () => {
  // O servidor MCP de teste roda neste processo; a API do E2E libera 127.0.0.1 no anti-SSRF.
  mcp = await startMcpTestServer();
  ({
    admin,
    project: { id: projectId },
  } = await createProject({ editor: 'editor' }));
  editor = await ApiSession.login('editor');
});
test.afterAll(async () => {
  await mcp.close();
  await editor.dispose();
  await admin.dispose();
});

test.describe('spec 010 — HU-1: catálogo MCP pela administração', () => {
  test('FR-001/FR-002/HU-1.1: cadastra, testa, aprova e libera uma tool', async ({ page }) => {
    const name = `Teste ${suffix}`;
    await loginViaUi(page, 'admin', '/admin/mcp');
    await page.getByRole('button', { name: 'Novo servidor' }).click();
    const form = page.getByTestId('mcp-server-form');
    await form.getByLabel('Nome').fill(name);
    await form.getByLabel('URL').fill(`${mcp.url}/mcp`);
    await form.getByRole('button', { name: 'Salvar' }).click();
    const row = page.getByTestId(`mcp-server-${name}`);
    await expect(row).toContainText('Aguardando aprovação');

    // Teste: capacidades e tools disponíveis.
    await page.getByRole('button', { name: `Testar ${name}` }).click();
    const result = page.getByTestId('mcp-test-result');
    await expect(result).toContainText('protocolo 2025-11-25');
    await expect(result).toContainText('soma');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: `Aprovar ${name}` }).click();
    await expect(row).toContainText('Ativo');
    await row.getByRole('button', { name, exact: true }).click();
    const tools = page.getByTestId('mcp-tools');
    // Negadas por padrão.
    await expect(tools.getByTestId('mcp-tool-soma')).toContainText('padrão (negada)');
    await tools.getByLabel('Liberar soma').check();
    await tools.getByLabel('Destrutiva apagar_registro').check();
    await tools.getByRole('button', { name: 'Salvar políticas' }).click();
    await expect(page.getByText('Políticas salvas')).toBeVisible();
    await expect(tools.getByTestId('mcp-tool-soma')).toContainText('global');
  });
});

test.describe('spec 010 — HU-2/FR-009: nó Cliente MCP no editor', () => {
  test('FR-009/SC-001: formulário gerado do schema da tool, execução e chamadas registradas', async ({
    page,
  }) => {
    const server = await approvedServer(`Editor ${suffix}`);
    const wf = await createWorkflow(editor, projectId, 'MCP E2E', mcpDefinition(server.id));
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByTestId('node-MCP').dblclick();
    // Só as tools liberadas aparecem; o formulário vem do inputSchema aprovado.
    const tool = page.getByTestId('param-toolName');
    await expect(tool.locator('option')).toHaveText(['Selecione…', 'soma']);
    await tool.selectOption('soma');
    await expect(page.getByTestId('param-arguments')).toContainText('Soma dois números.');
    await page.getByTestId('param-arguments.a').fill('20');
    await page.getByTestId('param-arguments.b').fill('22');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Workflow salvo')).toBeVisible();

    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(page.getByTestId('node-MCP').getByTestId('node-status')).toHaveAttribute(
      'data-status',
      'success',
    );
    await page.getByTestId('node-MCP').dblclick();
    await expect(page.getByTestId('ndv-output')).toContainText('42');
    // FR-011: a chamada aparece no painel do nó.
    const calls = page.getByTestId('ndv-mcp-calls');
    await expect(calls).toContainText('callTool · soma');
    await expect(calls).toContainText('sucesso');
    await expect(calls).toContainText('{"a":20,"b":22}');
  });

  test('FR-003/SC-003: mudança no servidor aparece como diff e é aceita na administração', async ({
    page,
  }) => {
    const name = `Diff ${suffix}`;
    const server = await approvedServer(name);
    const wf = await createWorkflow(
      editor,
      projectId,
      'MCP diff',
      mcpDefinition(server.id, { toolName: 'soma', arguments: { a: 1, b: 2 } }),
    );
    mcp.setMutateSchema(true);
    try {
      const run = await editor.call('POST', `/workflows/${wf.id}/test-run`, {
        definition: wf.definition,
      });
      const { executionId } = run.body as TestRunResponse;
      await expect
        .poll(async () => {
          const detail = (await editor.call('GET', `/executions/${executionId}`))
            .body as ExecutionDetail;
          return detail.error?.message ?? detail.status;
        })
        .toContain('mudou desde a aprovação');

      await loginViaUi(page, 'admin', '/admin/mcp');
      const row = page.getByTestId(`mcp-server-${name}`);
      await expect(row).toContainText('Mudança pendente');
      await row.getByRole('button', { name, exact: true }).click();
      const diff = page.getByTestId('mcp-diff-soma');
      await expect(diff).toContainText('Alterada');
      await expect(diff).toContainText('Soma dois números.');
      await expect(diff).toContainText('~/.ssh');
      await page.getByRole('button', { name: 'Aceitar mudança' }).click();
      await expect(page.getByText('Mudança aceita')).toBeVisible();
      await expect(page.getByTestId('mcp-diff')).toHaveCount(0);
    } finally {
      mcp.setMutateSchema(false);
    }
  });
});

test.describe('spec 010 — HU-3/FR-007: servidor autenticado por OAuth', () => {
  test('FR-007/SC-006: "Conectar" abre a autorização no IdP e a credencial fica conectada', async ({
    page,
  }) => {
    // Servidor MCP protegido pelo Keycloak do compose (client `olly-mcp`, audience `olly-mcp-test`).
    const secured = await startMcpTestServer({
      auth: {
        kind: 'oauth',
        issuer: 'http://localhost:8080/realms/olly',
        audience: 'olly-mcp-test',
      },
    });
    try {
      const name = `MCP OAuth ${suffix}`;
      const created = await admin.call('POST', `/projects/${projectId}/credentials`, {
        name,
        type: 'mcpOAuth',
        data: { serverUrl: `${secured.url}/mcp`, clientId: 'olly-mcp' },
      });
      expect(created.status).toBe(201);
      const credential = created.body as CredentialSummary;

      await loginViaUi(page, 'admin', `/credentials?project=${projectId}`);
      const row = page.getByTestId(`credential-${name}`);
      await expect(row.getByTestId('oauth-status')).toHaveText('Não conectada');
      const popupPromise = page.waitForEvent('popup');
      await row.getByRole('button', { name: `Conectar ${name}` }).click();
      const popup = await popupPromise;
      // Com a sessão do IdP aberta (login da tela), o popup volta direto e se fecha sozinho.
      await popup.waitForLoadState().catch(() => undefined);
      if (
        !popup.isClosed() &&
        (await popup
          .locator('#username')
          .isVisible()
          .catch(() => false))
      ) {
        await popup.locator('#username').fill('admin@olly.local');
        await popup.locator('#password').fill(PASSWORD);
        await popup.locator('#kc-login').click();
      }
      await expect(page.getByText('Servidor MCP conectado')).toBeVisible();
      await expect(row.getByTestId('oauth-status')).toHaveText('Conectada');
      const status = await admin.call('GET', `/credentials/${credential.id}/oauth/status`);
      expect(status.body).toMatchObject({ connected: true });
    } finally {
      await secured.close();
    }
  });
});
