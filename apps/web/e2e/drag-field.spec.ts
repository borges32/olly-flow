import { expect, test } from '@playwright/test';
import type { WorkflowDefinition } from '@olly/shared-types';
import { createProject, createWorkflow, loginViaUi } from './support';

const definition: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 's',
      type: 'data.set',
      name: 'Saudar',
      params: { fields: [{ name: 'saudacao', type: 'string', value: '' }] },
      position: [260, 0],
    },
  ],
  edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 's', toPort: 'main' }],
  settings: {},
  pinData: { m: [{ json: { nome: 'Ana', cliente: { cidade: 'Recife' } } }] },
};

test('spec 003 — SC-005/FR-018: arrastar campo gera a expressão, com preview e autocomplete', async ({
  page,
}) => {
  const { project, admin } = await createProject({ editor: 'editor' });
  const wf = await createWorkflow(admin, project.id, 'Arrastar', definition);
  await admin.dispose();

  await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
  await page.getByRole('button', { name: 'Executar workflow' }).click();
  await expect(page.getByTestId('node-Saudar').getByTestId('node-status')).toHaveAttribute(
    'data-status',
    'success',
  );

  await page.getByTestId('node-Saudar').dblclick();
  const input = page.getByTestId('ndv-input');
  const value = page.getByTestId('param-fields.0.value');

  // Entrada do próprio nó → $json.
  await input.getByTestId('field-nome').dragTo(value);
  await expect(value).toHaveAttribute('data-expression', 'true');
  await expect(value).toHaveValue('{{ $json.nome }}');
  await expect(page.getByTestId('param-fields.0.value-preview')).toHaveText('Resultado: Ana');

  // Autocomplete com os campos da última execução.
  await value.click();
  await value.press('End');
  await value.pressSequentially(' de {{ $json.cli');
  await expect(page.getByTestId('param-fields.0.value-suggestions')).toContainText('cliente');
  await value.press('Enter');
  await value.pressSequentially('.ci');
  await value.press('Enter');
  await value.pressSequentially(' }}');
  await expect(value).toHaveValue('{{ $json.nome }} de {{ $json.cliente.cidade }}');
  await expect(page.getByTestId('param-fields.0.value-preview')).toHaveText(
    'Resultado: Ana de Recife',
  );

  // Saída de um nó anterior → $('Nó').item.json.
  await page.getByTestId('param-fields.0.value-mode').getByRole('button', { name: 'Fixo' }).click();
  await expect(value).toHaveValue('');
  await page
    .getByLabel('Origem dos dados de entrada')
    .selectOption({ label: "Saída de “Início” ($('Início'))" });
  await input.getByTestId('field-nome').dragTo(value);
  await expect(value).toHaveValue("{{ $('Início').item.json.nome }}");
  await expect(page.getByTestId('param-fields.0.value-preview')).toHaveText('Resultado: Ana');
});
