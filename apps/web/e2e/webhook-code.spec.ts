import { expect, request, test, type Page } from '@playwright/test';
import type { WorkflowDefinition } from '@olly/shared-types';
import { createProject, createWorkflow, loginViaUi, type ApiSession } from './support';

let admin: ApiSession;
let projectId: string;

test.beforeAll(async () => {
  ({
    admin,
    project: { id: projectId },
  } = await createProject({ editor: 'editor', executor: 'executor' }));
});
test.afterAll(async () => {
  await admin.dispose();
});

const status = (page: Page, name: string) =>
  page.getByTestId(`node-${name}`).getByTestId('node-status');

const webhookFlow = (path: string): WorkflowDefinition => ({
  nodes: [
    {
      id: 'w',
      type: 'trigger.webhook',
      name: 'Webhook',
      params: { httpMethod: 'POST', path, responseMode: 'lastNode' },
      position: [0, 0],
    },
    {
      id: 's',
      type: 'data.set',
      name: 'Montar',
      params: {
        fields: [{ name: 'saudacao', type: 'string', value: '=Olá, {{ $json.body.nome }}' }],
      },
      position: [260, 0],
    },
  ],
  edges: [{ id: 'e1', from: 'w', fromPort: 'main', to: 's', toPort: 'main' }],
  settings: {},
});

test.describe('spec 005 — webhook, publicação, execuções e código pelo editor', () => {
  test('FR-007/FR-001/FR-013/FR-015: escuta de teste, publicação, execuções e copiar para o editor', async ({
    page,
  }) => {
    const path = `e2e-${Date.now()}`;
    const wf = await createWorkflow(admin, projectId, 'Webhook E2E', webhookFlow(path));
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await expect(page.getByTestId('publish-badge')).toHaveText('Não publicada');

    // HU-2: escuta a chamada de teste e vê o workflow rodar no editor.
    await page.getByTestId('node-Webhook').dblclick();
    await expect(page.getByTestId('webhook-test-url')).toHaveText(
      `http://localhost:5173/webhook-test/${path}`,
    );
    await page.getByRole('button', { name: 'Escutar chamada de teste' }).click();
    await expect(page.getByTestId('webhook-listening')).toBeVisible();
    const outside = await request.newContext();
    const testCall = await outside.post(`http://localhost:5173/webhook-test/${path}`, {
      data: { nome: 'Ana' },
    });
    // HU-2.1: a escuta pelo nó para no Webhook; os próximos nós esperam o ▶.
    expect(testCall.status()).toBe(202);
    await expect(page.getByText('Chamada de teste recebida')).toBeVisible();
    await expect(page.getByTestId('webhook-listening')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(status(page, 'Webhook')).toHaveAttribute('data-status', 'success');
    await expect(status(page, 'Montar')).toHaveCount(0);
    // ▶ no próximo nó: usa o payload recebido, sem nova chamada.
    const montar = page.getByTestId('node-Montar');
    await montar.hover();
    const body = page.waitForRequest((r) => r.url().endsWith('/test-run'));
    await montar.getByRole('button', { name: 'Executar o nó Montar' }).click();
    expect(
      ((await body).postDataJSON() as { reuse?: Record<string, string> }).reuse,
    ).toHaveProperty('w');
    await expect(status(page, 'Montar')).toHaveAttribute('data-status', 'success');
    await montar.dblclick();
    await expect(
      page.getByTestId('ndv-output').getByRole('cell', { name: 'Olá, Ana' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    // HU-1: publica e chama a URL de produção.
    expect(
      (await outside.post(`http://localhost:5173/webhook/${path}`, { data: {} })).status(),
    ).toBe(404);
    // Spec 009, FR-009: a publicação pede uma mensagem.
    await page.getByRole('button', { name: 'Publicar' }).click();
    const dialog = page.getByTestId('publish-dialog');
    await dialog.getByLabel('Mensagem da publicação').fill('Primeira versão');
    await dialog.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByTestId('publish-badge')).toHaveText('Publicada v1');
    const prod = await outside.post(`http://localhost:5173/webhook/${path}`, {
      data: { nome: 'Bruno' },
    });
    expect(await prod.json()).toEqual({ saudacao: 'Olá, Bruno' });
    await outside.dispose();

    // HU-4: a execução de produção aparece na lista e abre no canvas somente leitura.
    await page.goto(`/executions?project=${projectId}`);
    const table = page.getByTestId('executions-table');
    await expect(table.getByRole('row')).toHaveCount(4);
    await page.getByLabel('Modo').selectOption('production');
    await expect(table.getByRole('row')).toHaveCount(2);
    await table.getByRole('link', { name: 'Webhook E2E' }).click();
    await expect(page.getByTestId('execution-badge')).toContainText(
      'Execução de produção · success',
    );
    await expect(status(page, 'Montar')).toHaveAttribute('data-status', 'success');
    await page.getByTestId('node-Montar').dblclick();
    await expect(
      page.getByTestId('ndv-output').getByRole('cell', { name: 'Olá, Bruno' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    // FR-015: copiar para o editor fixa a saída do gatilho no rascunho.
    await page.getByRole('button', { name: 'Copiar para o editor' }).click();
    await expect(page).toHaveURL(new RegExp(`/workflows/${wf.id}$`));
    await expect(page.getByTestId('node-Webhook').getByTestId('node-pinned')).toBeVisible();
    await expect(page.getByTestId('dirty-indicator')).toBeVisible();
  });

  test('FR-014: quem não tem execution:readData vê a execução sem os dados', async ({ page }) => {
    const wf = await createWorkflow(admin, projectId, 'Sem dados', {
      nodes: [
        { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
        {
          id: 's',
          type: 'data.set',
          name: 'Montar',
          // O valor só existe na saída da execução (não na definição do workflow).
          params: {
            fields: [{ name: 'cpf', type: 'string', value: "={{ ['123', '456'].join('.') }}" }],
          },
          position: [260, 0],
        },
      ],
      edges: [{ id: 'e1', from: 'm', fromPort: 'main', to: 's', toPort: 'main' }],
      settings: {},
    });
    await loginViaUi(page, 'executor', `/workflows/${wf.id}`);
    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(status(page, 'Montar')).toHaveAttribute('data-status', 'success');
    await page.getByTestId('node-Montar').dblclick();
    await expect(page.getByTestId('ndv-output')).toContainText(
      'Sem a permissão execution:readData',
    );
    await expect(page.getByTestId('ndv-output').getByText('123.456')).toHaveCount(0);
  });

  test('FR-009/FR-012: editor de código com autocomplete dos nós e saída do console', async ({
    page,
  }) => {
    const wf = await createWorkflow(admin, projectId, 'Código E2E', {
      nodes: [
        { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
        {
          id: 'c',
          type: 'code.javascript',
          name: 'Código',
          params: { mode: 'runOnceForAllItems', jsCode: 'return [];' },
          position: [260, 0],
        },
      ],
      edges: [{ id: 'e1', from: 'm', fromPort: 'main', to: 'c', toPort: 'main' }],
      settings: {},
      pinData: { m: [{ json: { q: 2, p: 5 } }, { json: { q: 3, p: 10 } }] },
    });
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByTestId('node-Código').dblclick();
    const editor = page.getByTestId('param-jsCode').locator('.monaco-editor');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    // Autocomplete: $(' sugere os nós do workflow.
    await page.keyboard.type("const origem = $('");
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.suggest-widget')).toContainText('Início');
    // Esc fecha as sugestões, não o painel do nó.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ndv')).toBeVisible();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText(
      "console.log('itens', $input.all().length);\nreturn $input.all().map(i => ({ json: { total: i.json.q * i.json.p } }));",
    );
    await page.getByRole('button', { name: 'Executar este nó' }).click();
    await expect(page.getByTestId('ndv-output').getByTestId('ndv-output-count')).toHaveText(
      '2 itens',
    );
    await expect(page.getByTestId('ndv-output').getByRole('cell', { name: '30' })).toBeVisible();
    await expect(page.getByTestId('ndv-console')).toContainText('itens 2');
  });
});
