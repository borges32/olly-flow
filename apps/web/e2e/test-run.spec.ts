import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
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

/** Clica em "Baixar" no painel e devolve o nome e o conteúdo do arquivo (spec 019). */
async function downloadFrom(
  page: Page,
  panel: Locator,
): Promise<{ name: string; items: Record<string, unknown>[] }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Baixar' }).click(),
  ]);
  return {
    name: download.suggestedFilename(),
    items: JSON.parse(await readFile(await download.path(), 'utf8')) as Record<string, unknown>[],
  };
}

const jsonView = async (panel: Locator, testId: string) => {
  await panel.getByRole('tab', { name: 'JSON' }).click();
  return JSON.parse(await panel.getByTestId(`${testId}-json`).innerText()) as unknown;
};

test.describe('spec 019 — baixar os dados do nó', () => {
  test('FR-001/FR-002/FR-003/FR-004/SC-001/SC-002: baixa a entrada e cada saída do If com os itens do painel', async ({
    page,
  }) => {
    const wf = await createWorkflow(admin, projectId, 'Baixar dados', definition);
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);

    // FR-004: sem execução, o painel não tem itens e não oferece o download.
    await page.getByTestId('node-Adulto?').dblclick();
    await expect(page.getByTestId('ndv-input-download')).toHaveCount(0);
    await expect(page.getByTestId('ndv-output-download')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(status(page, 'Adulto?')).toHaveAttribute('data-status', 'success');
    await page.getByTestId('node-Adulto?').dblclick();
    const input = page.getByTestId('ndv-input');
    const output = page.getByTestId('ndv-output');

    // SC-001: entrada e cada saída, com os mesmos itens da visão JSON e nomes distintos.
    const fromInput = await downloadFrom(page, input);
    expect(fromInput.name).toBe('Adulto_-entrada.json');
    expect(fromInput.items).toHaveLength(2);
    expect(fromInput.items).toEqual(await jsonView(input, 'ndv-input'));

    const trueBranch = await downloadFrom(page, output);
    expect(trueBranch.name).toBe('Adulto_-saida-Verdadeiro.json');
    expect(trueBranch.items).toEqual([expect.objectContaining({ nomeCompleto: 'Ana Souza' })]);
    await output.getByRole('tab', { name: 'Falso (1)' }).click();
    const falseBranch = await downloadFrom(page, output);
    expect(falseBranch.name).toBe('Adulto_-saida-Falso.json');
    expect(falseBranch.items).toEqual(await jsonView(output, 'ndv-output'));
    expect(falseBranch.items).toEqual([expect.objectContaining({ nomeCompleto: 'Bruno Lima' })]);

    // Origem da entrada num nó anterior: o arquivo traz a saída dele.
    await page.getByLabel('Origem dos dados de entrada').selectOption('m');
    const fromSource = await downloadFrom(page, input);
    expect(fromSource.name).toBe('Início-saida.json');
    expect(fromSource.items).toEqual([
      { nome: 'Ana', sobrenome: 'Souza', idade: 34 },
      { nome: 'Bruno', sobrenome: 'Lima', idade: 16 },
    ]);
    await page.keyboard.press('Escape');

    // SC-002: o arquivo baixado vira dados fixados sem ajuste, e os fixados também são baixados.
    await page.getByTestId('node-Montar').dblclick();
    const montar = await downloadFrom(page, page.getByTestId('ndv-output'));
    expect(montar.name).toBe('Montar-saida.json');
    await page.getByRole('button', { name: 'Fixar dados' }).click();
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.getByTestId('pin-editor').fill(JSON.stringify(montar.items));
    await page.getByRole('button', { name: 'Salvar dados fixados' }).click();
    const pinned = await downloadFrom(page, page.getByTestId('ndv-output'));
    expect(pinned.name).toBe('Montar-saida-fixada.json');
    expect(pinned.items).toEqual(montar.items);
  });
});

test.describe('spec 024 — próximo nó na execução nó a nó', () => {
  test('FR-001/FR-002/SC-001: destaca o próximo nó, só no ramo do If com itens, e o destaque passa adiante', async ({
    page,
  }) => {
    const branch = (id: string, name: string, x: number, y: number) => ({
      id,
      type: 'data.set',
      name,
      params: { fields: [{ name: 'ramo', type: 'string', value: name }] },
      position: [x, y] as [number, number],
    });
    const wf = await createWorkflow(admin, projectId, 'Próximo nó', {
      ...definition,
      nodes: [...definition.nodes, branch('a', 'Sim', 780, -80), branch('b', 'Não', 780, 80)],
      edges: [
        ...definition.edges,
        { id: 'e3', from: 'i', fromPort: 'true', to: 'a', toPort: 'main' },
        { id: 'e4', from: 'i', fromPort: 'false', to: 'b', toPort: 'main' },
      ],
      // Só um adulto: todos os itens vão para o ramo Verdadeiro.
      pinData: { m: [{ json: { nome: 'Ana', sobrenome: 'Souza', idade: 34 } }] },
    });
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    const node = (name: string) => page.getByTestId(`node-${name}`);
    const pending = page.locator('[data-next]');
    const runNode = async (name: string) => {
      // Selecionado, o botão ▶ fica visível sem depender do mouse sobre o nó.
      await node(name).click();
      await node(name)
        .getByRole('button', { name: `Executar o nó ${name}` })
        .click();
      await expect(status(page, name)).toHaveAttribute('data-status', 'success');
    };

    // Sem execução, nenhum destaque (FR-003).
    await expect(node('Montar')).toBeVisible();
    await expect(pending).toHaveCount(0);

    await runNode('Montar');
    await expect(pending).toHaveCount(1);
    await expect(node('Adulto?')).toHaveAttribute('data-next', 'true');
    await expect(node('Adulto?').getByTestId('node-next')).toHaveText('próximo');

    // Depois do If, só o ramo com itens.
    await runNode('Adulto?');
    await expect(node('Sim')).toHaveAttribute('data-next', 'true');
    await expect(node('Não')).not.toHaveAttribute('data-next');
    await expect(pending).toHaveCount(1);

    await runNode('Sim');
    await expect(pending).toHaveCount(0);
  });
});

test.describe('spec 003 — If com condição criada no formulário', () => {
  test('FR-010 (correção 16/10/2026): a condição adicionada pelo formulário grava o operador e o If encaminha os itens', async ({
    page,
  }) => {
    const wf = await createWorkflow(admin, projectId, 'If pelo formulário', {
      nodes: [
        definition.nodes[0] as WorkflowDefinition['nodes'][number],
        {
          id: 'i',
          type: 'logic.if',
          name: 'Rota',
          params: { conditions: { combinator: 'and', conditions: [] } },
          position: [260, 0],
        },
      ],
      edges: [{ id: 'e1', from: 'm', fromPort: 'main', to: 'i', toPort: 'main' }],
      settings: {},
      pinData: definition.pinData,
    });
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByTestId('node-Rota').dblclick();
    const panel = page.getByTestId('parameter-panel');
    await panel.getByRole('button', { name: 'Adicionar' }).click();
    await panel
      .getByTestId('param-conditions.conditions.0.leftValue-mode')
      .getByRole('button', { name: 'Expressão' })
      .click();
    await panel.getByTestId('param-conditions.conditions.0.leftValue').fill('{{ $json.nome }}');
    await panel.getByTestId('param-conditions.conditions.0.rightValue').fill('Ana');
    await expect(panel.getByTestId('param-conditions.conditions.0.operator.type')).toHaveValue(
      'string',
    );

    await page.getByRole('button', { name: 'Executar este nó' }).click();
    const output = page.getByTestId('ndv-output');
    await expect(output.getByRole('tab', { name: 'Verdadeiro (1)' })).toBeVisible();
    await expect(output.getByRole('tab', { name: 'Falso (1)' })).toBeVisible();
    await page.keyboard.press('Escape');

    // O operador foi gravado com o padrão mostrado na tela.
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Workflow salvo')).toBeVisible();
    const saved = await admin.call('GET', `/workflows/${wf.id}`);
    const rota = (saved.body as { definition: WorkflowDefinition }).definition.nodes.find(
      (n) => n.id === 'i',
    );
    expect(rota?.params).toMatchObject({
      conditions: {
        conditions: [{ rightValue: 'Ana', operator: { type: 'string', operation: 'equals' } }],
      },
    });
  });
});
