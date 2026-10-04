import { expect, test, type Page } from '@playwright/test';
import {
  connectNodes,
  createProject,
  createWorkflow,
  loginViaUi,
  manualSetDefinition,
  type ApiSession,
} from './support';

let admin: ApiSession;
let projectId: string;

test.beforeAll(async () => {
  const setup = await createProject({ editor: 'editor' });
  admin = setup.admin;
  projectId = setup.project.id;
});
test.afterAll(async () => {
  await admin.dispose();
});

const node = (page: Page, name: string) => page.getByTestId(`node-${name}`);

async function positions(page: Page): Promise<Record<string, [string | null, string | null]>> {
  const result: Record<string, [string | null, string | null]> = {};
  for (const el of await page
    .locator('[data-testid^="node-"]:not([data-testid="node-error"])')
    .all()) {
    const id = (await el.getAttribute('data-testid')) ?? '';
    result[id] = [await el.getAttribute('data-x'), await el.getAttribute('data-y')];
  }
  return result;
}

test.describe('spec 002 — editor visual', () => {
  test('SC-001/FR-007/FR-009: cria Manual → Set, salva, recarrega e confere layout e parâmetros', async ({
    page,
  }) => {
    await loginViaUi(page, 'editor', `/workflows?project=${projectId}`);
    await page.getByRole('button', { name: 'Novo workflow' }).click();
    await page.getByLabel('Nome').fill('Fluxo E2E');
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/);

    // Paleta com busca e categorias.
    const palette = page.getByTestId('node-palette');
    await expect(palette.getByRole('heading', { name: 'Gatilhos' })).toBeVisible();
    await palette.getByLabel('Buscar nós').fill('defin');
    await expect(palette.getByRole('button', { name: 'Gatilho manual' })).toBeHidden();
    await palette.getByLabel('Buscar nós').fill('');
    await palette.getByRole('button', { name: 'Gatilho manual' }).click();
    await palette.getByRole('button', { name: 'Definir campos' }).click();
    await expect(node(page, 'Gatilho manual')).toBeVisible();
    await expect(node(page, 'Definir campos')).toBeVisible();

    await connectNodes(page, 'Gatilho manual', 'Definir campos');
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);

    // Painel do nó (clique duplo) com o formulário gerado pelo schema.
    await node(page, 'Definir campos').dblclick();
    const panel = page.getByTestId('parameter-panel');
    await panel.getByRole('button', { name: 'Adicionar' }).click();
    await panel.getByTestId('param-fields.0.name').fill('cliente.nome');
    await panel.getByTestId('param-fields.0.value').fill('Ana');
    await expect(panel.getByTestId('param-fields.0.type')).toHaveValue('string');
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('dirty-indicator')).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Workflow salvo')).toBeVisible();
    await expect(page.getByTestId('dirty-indicator')).toBeHidden();

    const before = await positions(page);
    await page.reload();
    await expect(node(page, 'Definir campos')).toBeVisible();
    expect(await positions(page)).toEqual(before);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await node(page, 'Definir campos').dblclick();
    await expect(panel.getByTestId('param-fields.0.name')).toHaveValue('cliente.nome');
    await expect(panel.getByTestId('param-fields.0.value')).toHaveValue('Ana');
  });

  test('FR-008: desfazer/refazer, copiar/colar com nomes únicos e excluir por teclado', async ({
    page,
  }) => {
    const wf = await createWorkflow(admin, projectId, 'Atalhos', manualSetDefinition);
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await node(page, 'Definir campos').click();
    await page.getByTestId('canvas').focus();

    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(node(page, 'Definir campos1')).toBeVisible();
    await expect(page.getByTestId('dirty-indicator')).toBeVisible();
    await page.keyboard.press('Control+v');
    await expect(node(page, 'Definir campos2')).toBeVisible();

    await page.keyboard.press('Delete');
    await expect(node(page, 'Definir campos2')).toBeHidden();
    await page.keyboard.press('Control+z');
    await expect(node(page, 'Definir campos2')).toBeVisible();
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect(node(page, 'Definir campos1')).toBeHidden();
    await page.keyboard.press('Control+Shift+z');
    await expect(node(page, 'Definir campos1')).toBeVisible();

    // Zoom, enquadrar e minimapa.
    await expect(page.locator('.react-flow__minimap')).toBeVisible();
    await page.getByRole('button', { name: /zoom in/i }).click();
    await page.getByRole('button', { name: /fit view/i }).click();
  });

  test('FR-005/HU-1.3: ciclo ao salvar destaca os nós envolvidos', async ({ page }) => {
    const [trigger, first] = manualSetDefinition.nodes;
    if (!trigger || !first) throw new Error('fixture inválida');
    const wf = await createWorkflow(admin, projectId, 'Ciclo', {
      ...manualSetDefinition,
      nodes: [
        trigger,
        first,
        { ...first, id: 's2', name: 'Definir campos B', position: [300, 220] },
      ],
    });
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await connectNodes(page, 'Definir campos', 'Definir campos B');
    await connectNodes(page, 'Definir campos B', 'Definir campos');
    await expect(page.locator('.react-flow__edge')).toHaveCount(3);

    await page.keyboard.press('Control+s');
    await expect(page.getByText('O workflow tem erros')).toBeVisible();
    await expect(node(page, 'Definir campos').getByTestId('node-error')).toBeVisible();
    await expect(node(page, 'Definir campos B').getByTestId('node-error')).toBeVisible();
    await expect(node(page, 'Gatilho manual').getByTestId('node-error')).toBeHidden();
    await expect(page.getByTestId('issues-panel')).toContainText('Ciclo');
  });

  test('FR-003/HU-1.2: salvar sobre versão desatualizada avisa e permite recarregar', async ({
    page,
  }) => {
    const wf = await createWorkflow(admin, projectId, 'Concorrência', manualSetDefinition);
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await expect(node(page, 'Definir campos')).toBeVisible();

    const other = await admin.call('PUT', `/workflows/${wf.id}`, {
      name: 'Alterado por outra pessoa',
      definition: manualSetDefinition,
      baseVersion: wf.version,
    });
    expect(other.status).toBe(200);

    await page.getByLabel('Nome do workflow').fill('Minha alteração');
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('dialog')).toContainText('Workflow alterado por outra pessoa');
    await page.getByRole('button', { name: 'Recarregar versão mais recente' }).click();
    await expect(page.getByLabel('Nome do workflow')).toHaveValue('Alterado por outra pessoa');
    await expect(page.getByTestId('dirty-indicator')).toBeHidden();
  });
});
