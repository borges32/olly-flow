import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { WorkflowFile } from '@olly/shared-types';
import {
  ApiSession,
  createProject,
  createWorkflow,
  loginViaUi,
  manualSetDefinition,
} from './support';

const N8N_FIXTURE = fileURLToPath(
  new URL('../../../fixtures/n8n/exemplo-set-if/workflow.json', import.meta.url),
);

let editor: ApiSession;
let admin: ApiSession;
let projectId: string;
const suffix = `${Date.now()}`;

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeAll(async () => {
  ({
    admin,
    project: { id: projectId },
  } = await createProject({ editor: 'editor', viewer: 'viewer' }));
  editor = await ApiSession.login('editor');
});
test.afterAll(async () => {
  await editor.dispose();
  await admin.dispose();
});

async function downloaded(
  page: Page,
  click: () => Promise<void>,
): Promise<{ name: string; file: WorkflowFile }> {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await download.path();
  return {
    name: download.suggestedFilename(),
    file: JSON.parse(await readFile(path, 'utf8')) as WorkflowFile,
  };
}

/** Dispara um "colar" no canvas com o texto (como Ctrl+V com o texto na área de transferência). */
async function pasteText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.body.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true }),
    );
  }, text);
}

test.describe('spec 015 — baixar e importar workflows em JSON', () => {
  test('FR-006/FR-008: baixar pela lista (rascunho salvo) e pelo editor (canvas não salvo)', async ({
    page,
  }) => {
    const wf = await createWorkflow(editor, projectId, `Baixar ${suffix}`, manualSetDefinition);
    await loginViaUi(page, 'editor', `/workflows?project=${projectId}`);
    const fromList = await downloaded(page, () =>
      page.getByRole('button', { name: `Baixar Baixar ${suffix}` }).click(),
    );
    expect(fromList.name).toBe(`Baixar ${suffix}.json`);
    expect(fromList.file.nodes.map((n) => n.name)).toEqual(['Gatilho manual', 'Definir campos']);
    expect(fromList.file.connections['Gatilho manual']?.main?.[0]?.[0]?.node).toBe(
      'Definir campos',
    );

    await page.goto(`/workflows/${wf.id}`);
    await page.getByLabel('Nome do workflow').fill(`Editado ${suffix}`);
    const fromEditor = await downloaded(page, () =>
      page.getByRole('button', { name: 'Baixar', exact: true }).click(),
    );
    expect(fromEditor.name).toBe(`Editado ${suffix}.json`);
    expect(fromEditor.file.name).toBe(`Editado ${suffix}`);
  });

  test('FR-010/FR-011/FR-016: importar um JSON do Olly Flow (com tipo desconhecido) pela lista', async ({
    page,
  }) => {
    await loginViaUi(page, 'editor', `/workflows?project=${projectId}`);
    await page.getByRole('button', { name: 'Importar' }).click();
    const dialog = page.getByTestId('import-dialog');
    await dialog.getByLabel('Conteúdo (JSON)').fill(
      JSON.stringify({
        name: `Importado ${suffix}`,
        nodes: [
          { name: 'Início', type: 'trigger.manual' },
          { name: 'Planilha', type: 'outra.planilha', parameters: { aba: 'A' } },
        ],
        connections: { Início: { main: [[{ node: 'Planilha', type: 'main', index: 0 }]] } },
      }),
    );
    await dialog.getByRole('button', { name: 'Pré-visualizar' }).click();
    await expect(dialog.getByTestId('import-preview')).toContainText('2 nó(s) e 1 conexão(ões)');
    await expect(dialog.getByTestId('import-pending')).toContainText('outra.planilha');
    await expect(dialog.getByLabel('Nome do workflow')).toHaveValue(`Importado ${suffix}`);
    await dialog.getByRole('button', { name: 'Importar', exact: true }).click();
    await expect(page.getByLabel('Nome do workflow')).toHaveValue(`Importado ${suffix}`);
    const placeholder = page.getByTestId('node-Planilha');
    await expect(placeholder).toHaveAttribute('data-unsupported', 'true');
    await expect(placeholder).toContainText('Não suportado: outra.planilha');
  });

  test('FR-010/FR-028: importar o JSON baixado de um workflow existente sobrepõe o rascunho dele', async ({
    page,
  }) => {
    const wf = await createWorkflow(editor, projectId, `Sobrepor ${suffix}`, manualSetDefinition);
    await loginViaUi(page, 'editor', `/workflows?project=${projectId}`);
    const { file } = await downloaded(page, () =>
      page.getByRole('button', { name: `Baixar Sobrepor ${suffix}` }).click(),
    );
    file.nodes.push({ name: 'Nó do arquivo', type: 'data.set', parameters: { fields: [] } });
    const rows = page.getByRole('row');
    const before = await rows.count();

    await page.getByRole('button', { name: 'Importar' }).click();
    const dialog = page.getByTestId('import-dialog');
    await dialog.getByLabel('Conteúdo (JSON)').fill(JSON.stringify(file));
    await dialog.getByRole('button', { name: 'Pré-visualizar' }).click();
    await expect(dialog.getByTestId('import-target')).toContainText(`Sobrepor ${suffix}`);
    await expect(dialog.getByTestId('import-target')).toContainText('versão 2');
    await dialog.getByRole('button', { name: 'Importar e sobrepor' }).click();

    await expect(page).toHaveURL(new RegExp(`/workflows/${wf.id}$`));
    await expect(page.getByTestId('node-Nó do arquivo')).toBeVisible();
    await page.goto(`/workflows?project=${projectId}`);
    await expect(page.getByRole('link', { name: `Sobrepor ${suffix}` })).toHaveCount(1);
    await expect(rows).toHaveCount(before);
  });

  test('HU-3/FR-026: importar um arquivo do N8N mostra o relatório de migração e cria o rascunho', async ({
    page,
  }) => {
    await loginViaUi(page, 'editor', `/workflows?project=${projectId}`);
    await page.getByRole('button', { name: 'Importar' }).click();
    const dialog = page.getByTestId('import-dialog');
    await dialog.getByLabel('Formato').selectOption('n8n');
    await dialog.getByLabel('Arquivo').setInputFiles(N8N_FIXTURE);
    await dialog.getByLabel('Nome do workflow').fill(`Do N8N ${suffix}`);
    await dialog.getByRole('button', { name: 'Pré-visualizar' }).click();
    await expect(dialog.getByTestId('import-migration')).toContainText('3 convertido(s)');
    await dialog.getByRole('button', { name: 'Importar', exact: true }).click();
    await expect(page.getByLabel('Nome do workflow')).toHaveValue(`Do N8N ${suffix}`);
    await expect(page.getByTestId('node-Maior de idade?')).toBeVisible();
  });

  test('FR-019/FR-020/SC-006: copiar nós vai para a área de transferência como JSON e colar acrescenta ao canvas', async ({
    page,
  }) => {
    const wf = await createWorkflow(editor, projectId, `Copiar ${suffix}`, manualSetDefinition);
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByTestId('node-Definir campos').click();
    await page.keyboard.press('Control+c');
    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('"nodes"');
    const copied = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    ) as WorkflowFile;
    expect(copied.nodes.map((n) => n.name)).toEqual(['Definir campos']);

    // Colar o texto (como depois de passar por um editor de texto) acrescenta com nome único.
    await pasteText(page, JSON.stringify(copied));
    await expect(page.getByTestId('node-Definir campos1')).toBeVisible();
    await expect(page.getByTestId('dirty-indicator')).toBeVisible();

    await pasteText(page, '{"nodes": [');
    await expect(page.getByText('O texto colado não é um workflow válido')).toBeVisible();
  });
});
