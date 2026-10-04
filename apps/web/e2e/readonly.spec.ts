import { expect, test } from '@playwright/test';
import {
  ApiSession,
  createProject,
  createWorkflow,
  loginViaUi,
  manualSetDefinition,
} from './support';

test('spec 002 — SC-002/FR-015: visualizador vê o canvas somente leitura e a API nega edição (403)', async ({
  page,
}) => {
  const { project, admin } = await createProject({ viewer: 'viewer' });
  const wf = await createWorkflow(admin, project.id, 'Somente leitura', manualSetDefinition);

  await loginViaUi(page, 'viewer', `/workflows?project=${project.id}`);
  await expect(page.getByRole('link', { name: 'Somente leitura' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo workflow' })).toBeHidden();
  await expect(page.getByRole('button', { name: /Excluir/ })).toBeHidden();

  await page.getByRole('link', { name: 'Somente leitura' }).click();
  await expect(page.getByTestId('readonly-badge')).toBeVisible();
  await expect(page.getByTestId('node-palette')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Salvar' })).toBeHidden();
  await expect(page.getByLabel('Nome do workflow')).toBeDisabled();

  const setNode = page.getByTestId('node-Definir campos');
  await setNode.dblclick();
  const panel = page.getByTestId('parameter-panel');
  await expect(panel.getByTestId('param-fields.0.value')).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Adicionar' })).toBeHidden();

  await page.keyboard.press('Escape');
  await page.locator('.react-flow__edge').hover({ force: true });
  await expect(page.getByRole('button', { name: 'Excluir conexão' })).toBeHidden();
  await setNode.click();
  // Sem workflow:execute, não há botão de executar no nó (spec 003, FR-020).
  await expect(page.getByRole('button', { name: 'Executar workflow' })).toBeHidden();
  await expect(setNode.getByTestId('node-run')).toHaveCount(0);
  await page.keyboard.press('Delete');
  await expect(setNode).toBeVisible();
  await expect(page.getByTestId('dirty-indicator')).toBeHidden();

  const viewer = await ApiSession.login('viewer');
  const res = await viewer.call('PUT', `/workflows/${wf.id}`, {
    definition: manualSetDefinition,
    baseVersion: wf.version,
  });
  expect(res.status).toBe(403);
  await viewer.dispose();
  await admin.dispose();
});
