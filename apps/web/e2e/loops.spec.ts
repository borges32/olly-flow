import { expect, test } from '@playwright/test';
import type { WorkflowDefinition } from '@olly/shared-types';
import { createProject, createWorkflow, loginViaUi, type ApiSession } from './support';

let admin: ApiSession;
let projectId: string;

test.beforeAll(async () => {
  ({
    admin,
    project: { id: projectId },
  } = await createProject({ editor: 'editor' }));
});
test.afterAll(async () => {
  await admin.dispose();
});

const loopFlow: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'w',
      type: 'logic.while',
      name: 'Enquanto',
      params: { condition: '={{ $loop.index < 3 }}', accumulate: 'appendBodyOutput' },
      position: [260, 0],
    },
    {
      id: 'b',
      type: 'data.set',
      name: 'Corpo',
      params: { fields: [{ name: 'volta', type: 'number', value: '={{ $loop.index }}' }] },
      position: [560, 0],
    },
    {
      id: 'mg',
      type: 'logic.merge',
      name: 'Junta',
      params: { mode: 'append', numberInputs: 3 },
      // Longe do minimapa (canto inferior direito), para o arraste do teste.
      position: [-200, 220],
    },
  ],
  edges: [
    { id: 'e1', from: 'm', fromPort: 'main', to: 'w', toPort: 'main' },
    { id: 'e2', from: 'w', fromPort: 'loop', to: 'b', toPort: 'main' },
    { id: 'e3', from: 'b', fromPort: 'main', to: 'w', toPort: 'continue' },
    { id: 'e4', from: 'w', fromPort: 'done', to: 'mg', toPort: 'input1' },
  ],
  settings: {},
};

test.describe('spec 007 — FR-010/FR-016: laços no editor', () => {
  test('FR-016/FR-010: aresta de retorno distinta, iterações no painel e ciclo inválido explicado', async ({
    page,
  }) => {
    const wf = await createWorkflow(admin, projectId, 'Laço E2E', loopFlow);
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);

    // FR-016: a volta para "Continuar" é desenhada com estilo próprio.
    await expect(page.locator('path.olly-back-edge')).toHaveCount(1);
    // FR-001: o Merge mostra as 3 entradas.
    await expect(page.getByTestId('node-Junta').locator('.react-flow__handle.target')).toHaveCount(
      3,
    );

    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(page.getByTestId('node-Junta').getByTestId('node-status')).toHaveAttribute(
      'data-status',
      'success',
    );

    // FR-010: o painel do nó do corpo navega entre as iterações.
    await page.getByTestId('node-Corpo').dblclick();
    const select = page.getByTestId('ndv-run-select');
    await expect(select.locator('option')).toHaveText([
      'Execução 1 de 3',
      'Execução 2 de 3',
      'Execução 3 de 3',
    ]);
    await expect(page.getByTestId('ndv-output').getByRole('cell', { name: '2' })).toBeVisible();
    await select.selectOption('0');
    await expect(
      page.getByTestId('ndv-output').getByRole('cell', { name: '0', exact: true }).last(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Fechar painel do nó' }).click();
    await expect(page.getByTestId('ndv')).toBeHidden();

    // FR-016: voltar pela entrada principal do While (e não por "Continuar") é ciclo inválido:
    // o editor explica a regra na hora e na conexão, e o salvamento recusa.
    const source = page.getByTestId('node-Junta').locator('.react-flow__handle.source');
    const target = page.getByTestId('node-Enquanto').locator('.react-flow__handle.target').first();
    const a = await source.boundingBox();
    const b = await target.boundingBox();
    if (!a || !b) throw new Error('handles não encontrados');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByText('Ciclo inválido', { exact: true })).toBeVisible();
    await expect(page.getByTestId('invalid-cycle-badge').first()).toHaveAttribute(
      'title',
      /entrada "continue"/,
    );
    await page.keyboard.press('Control+s');
    await expect(page.getByText('O workflow tem erros')).toBeVisible();
  });
});
