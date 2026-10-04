import { expect, test, type Page } from '@playwright/test';
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

const definition: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 's',
      type: 'data.set',
      name: 'Montar',
      params: {
        fields: [
          {
            name: 'nomeCompleto',
            type: 'string',
            value: '={{ $json.nome }} {{ $json.sobrenome }}',
          },
          { name: 'idade', type: 'number', value: '={{ $json.idade }}' },
        ],
      },
      position: [260, 0],
    },
    {
      id: 'i',
      type: 'logic.if',
      name: 'Adulto?',
      params: {
        conditions: {
          combinator: 'and',
          conditions: [
            {
              leftValue: '={{ $json.idade }}',
              rightValue: '18',
              operator: { type: 'number', operation: 'gte' },
            },
          ],
        },
      },
      position: [520, 0],
    },
  ],
  edges: [
    { id: 'e1', from: 'm', fromPort: 'main', to: 's', toPort: 'main' },
    { id: 'e2', from: 's', fromPort: 'main', to: 'i', toPort: 'main' },
  ],
  settings: {},
  pinData: {
    m: [
      { json: { nome: 'Ana', sobrenome: 'Souza', idade: 34 } },
      { json: { nome: 'Bruno', sobrenome: 'Lima', idade: 16 } },
    ],
  },
};

const status = (page: Page, name: string) =>
  page.getByTestId(`node-${name}`).getByTestId('node-status');

test.describe('spec 003 — execução de teste no editor', () => {
  test('SC-001/FR-012/FR-017: executa Manual → Set → If, mostra status em tempo real e os dados', async ({
    page,
  }) => {
    const wf = await createWorkflow(admin, projectId, 'Execução', definition);
    // Sem o GET de conferência, os status só podem chegar pelos eventos em tempo real.
    await page.route('**/api/v1/executions/*', (route) =>
      route.fulfill({ status: 503, body: '{}' }),
    );
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await expect(page.getByTestId('node-Início').getByTestId('node-pinned')).toBeVisible();

    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(status(page, 'Início')).toHaveAttribute('data-status', 'success');
    await expect(status(page, 'Montar')).toHaveText(/2 itens/);
    await expect(status(page, 'Adulto?')).toHaveAttribute('data-status', 'success');
    await page.unroute('**/api/v1/executions/*');

    // Painel do If: entrada em tabela, saídas por porta, JSON e schema.
    await page.getByTestId('node-Adulto?').dblclick();
    const input = page.getByTestId('ndv-input');
    await expect(input.getByTestId('ndv-input-count')).toHaveText('2 itens');
    await expect(input.getByRole('cell', { name: 'Ana Souza' })).toBeVisible();
    const output = page.getByTestId('ndv-output');
    await expect(output.getByRole('tab', { name: 'Verdadeiro (1)' })).toBeVisible();
    await output.getByRole('tab', { name: 'Falso (1)' }).click();
    await output.getByRole('tab', { name: 'JSON' }).click();
    await expect(output.getByTestId('ndv-output-json')).toContainText(
      '"nomeCompleto": "Bruno Lima"',
    );
    await input.getByRole('tab', { name: 'Schema' }).click();
    await expect(input.getByTestId('field-nomeCompleto')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('FR-020/HU-2.4: executa um nó por vez pelo botão no nó, reaproveitando os anteriores', async ({
    page,
  }) => {
    const wf = await createWorkflow(admin, projectId, 'Um nó por vez', definition);
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    const runNode = async (name: string) => {
      const node = page.getByTestId(`node-${name}`);
      await node.hover();
      const body = page.waitForRequest((r) => r.url().endsWith('/test-run'));
      await node.getByRole('button', { name: `Executar o nó ${name}` }).click();
      return (await body).postDataJSON() as {
        destinationNodeId?: string;
        reuse?: Record<string, string>;
      };
    };

    // Passo 1: só até Montar; o If ainda não rodou.
    const first = await runNode('Montar');
    expect(first).toMatchObject({ destinationNodeId: 's' });
    expect(first.reuse).toBeUndefined();
    await expect(status(page, 'Montar')).toHaveText(/2 itens/);
    await expect(status(page, 'Adulto?')).toHaveCount(0);

    // Passo 2: o If executa sobre a saída de Montar, sem executar Montar de novo.
    const second = await runNode('Adulto?');
    expect(second.destinationNodeId).toBe('i');
    expect(Object.keys(second.reuse ?? {}).sort()).toEqual(['m', 's']);
    await expect(status(page, 'Adulto?')).toHaveAttribute('data-status', 'success');
    await expect(status(page, 'Montar')).toHaveAttribute('title', /execução anterior/);
    await page.getByTestId('node-Adulto?').dblclick();
    await expect(
      page.getByTestId('ndv-output').getByRole('tab', { name: 'Verdadeiro (1)' }),
    ).toBeVisible();

    // Pelo painel: mesmo comando.
    await page.getByRole('button', { name: 'Executar este nó' }).click();
    await expect(page.getByTestId('ndv-output').getByTestId('ndv-output-count')).toHaveText(
      '1 item',
    );
    await page.keyboard.press('Escape');

    // Alterar Montar invalida o reaproveitamento dele; executar Montar descarta os dados do If.
    await page.getByTestId('node-Montar').dblclick();
    await page.getByTestId('param-fields.1.value').fill('{{ $json.idade + 10 }}');
    await page.keyboard.press('Escape');
    const third = await runNode('Adulto?');
    expect(Object.keys(third.reuse ?? {})).toEqual(['m']);
    await expect(status(page, 'Adulto?')).toHaveAttribute('data-status', 'success');
    await runNode('Montar');
    await expect(status(page, 'Montar')).toHaveAttribute('data-status', 'success');
    await expect(status(page, 'Adulto?')).toHaveCount(0);
  });

  test('FR-016: fixar e editar dados de saída; a próxima execução os usa sem executar o nó', async ({
    page,
  }) => {
    const wf = await createWorkflow(admin, projectId, 'Pin', definition);
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(status(page, 'Adulto?')).toHaveAttribute('data-status', 'success');

    await page.getByTestId('node-Montar').dblclick();
    await page.getByRole('button', { name: 'Fixar dados' }).click();
    await expect(page.getByRole('heading', { name: 'Saída (dados fixados)' })).toBeVisible();
    await page.getByRole('button', { name: 'Editar' }).click();
    await page
      .getByTestId('pin-editor')
      .fill('[{"nomeCompleto": "Fixo", "idade": 99}, {"nomeCompleto": "Outro", "idade": 50}]');
    await page.getByRole('button', { name: 'Salvar dados fixados' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('node-Montar').getByTestId('node-pinned')).toBeVisible();
    await expect(page.getByTestId('dirty-indicator')).toBeVisible();

    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(status(page, 'Adulto?')).toHaveAttribute('data-status', 'success');
    await page.getByTestId('node-Adulto?').dblclick();
    await expect(
      page.getByTestId('ndv-output').getByRole('tab', { name: 'Verdadeiro (2)' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    // Pin data é salvo com o workflow.
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Workflow salvo')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('node-Montar').getByTestId('node-pinned')).toBeVisible();
  });

  test('FR-007: erro de expressão aparece no nó com a mensagem', async ({ page }) => {
    const broken: WorkflowDefinition = {
      ...definition,
      nodes: definition.nodes.map((n) =>
        n.id === 's'
          ? { ...n, params: { fields: [{ name: 'x', type: 'string', value: '={{ $json.a.b }}' }] } }
          : n,
      ),
    };
    const wf = await createWorkflow(admin, projectId, 'Erro', broken);
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(status(page, 'Montar')).toHaveAttribute('data-status', 'error');
    await expect(page.getByText('Execução com erro')).toBeVisible();
    await page.getByTestId('node-Montar').dblclick();
    await expect(page.getByTestId('ndv-output')).toContainText(
      'parâmetro "fields[0].value" do nó "Montar"',
    );
  });
});
