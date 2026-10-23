import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { ExecutionDetail, TestRunResponse, WorkflowDefinition } from '@olly/shared-types';
import { ApiSession, createProject, createWorkflow, loginViaUi } from './support';

let admin: ApiSession;
let editor: ApiSession;
let projectId: string;
let executionId: string;
let childId: string;

/** Executa pela API (como o editor) e espera terminar. */
async function run(workflowId: string, definition: WorkflowDefinition): Promise<string> {
  const res = await editor.call('POST', `/workflows/${workflowId}/test-run`, { definition });
  if (res.status !== 202)
    throw new Error(`test-run: ${String(res.status)} ${JSON.stringify(res.body)}`);
  const id = (res.body as TestRunResponse).executionId;
  await expect
    .poll(
      async () => ((await editor.call('GET', `/executions/${id}`)).body as ExecutionDetail).status,
      { timeout: 20_000 },
    )
    .toMatch(/success|error|cancelled/);
  return id;
}

test.beforeAll(async () => {
  ({
    admin,
    project: { id: projectId },
  } = await createProject({ editor: 'editor', viewer: 'viewer' }));
  editor = await ApiSession.login('editor');
  const child = await createWorkflow(admin, projectId, 'Filho do log', {
    nodes: [
      { id: 't', type: 'trigger.executeWorkflow', name: 'Chamado', params: {}, position: [0, 0] },
    ],
    edges: [],
    settings: {},
  });
  childId = child.id;
  await admin.call('POST', `/workflows/${child.id}/publish`, { message: 'Sub-workflow' });
  const definition: WorkflowDefinition = {
    nodes: [
      { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
      {
        id: 'x',
        type: 'flow.executeWorkflow',
        name: 'Resolver',
        params: { workflowId: child.id, mode: 'once' },
        position: [220, 0],
      },
      {
        id: 'c',
        type: 'code.javascript',
        name: 'Validar',
        params: {
          mode: 'runOnceForAllItems',
          jsCode: "throw new Error('campo cpf ausente');",
        },
        position: [440, 0],
      },
    ],
    edges: [
      { id: 'e1', from: 'm', fromPort: 'main', to: 'x', toPort: 'main' },
      { id: 'e2', from: 'x', fromPort: 'main', to: 'c', toPort: 'main' },
    ],
    settings: {},
    pinData: { m: [{ json: { cpf: null } }] },
  };
  const wf = await createWorkflow(admin, projectId, 'Orquestrador do log', definition);
  executionId = await run(wf.id, definition);
});
test.afterAll(async () => {
  await editor.dispose();
  await admin.dispose();
});

const openMenu = async (page: Page, id: string) => {
  await page
    .getByTestId(`execution-${id}`)
    .getByRole('button', { name: 'Ações da execução' })
    .click();
  return page.getByRole('menu', { name: 'Ações da execução' });
};

test.describe('spec 026 — ações da execução', () => {
  test('FR-001/FR-002/FR-003/FR-004/SC-001: o log mostra os nós, o erro e a subexecução, filtra, baixa e abre a execução', async ({
    page,
  }) => {
    await loginViaUi(page, 'editor', `/executions?project=${projectId}`);
    const menu = await openMenu(page, executionId);
    await expect(menu.getByRole('menuitem', { name: 'Excluir' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Log' }).click();

    const log = page.getByTestId('execution-log');
    await expect(log.getByRole('heading')).toHaveText(
      `Log — execução ${executionId.slice(0, 8)} · Orquestrador do log`,
    );
    await expect(log.getByTestId('execution-log-summary')).toContainText('error · teste · manual');
    await expect(log.getByTestId('log-row-Início')).toContainText('trigger.manual');
    const resolver = log.getByTestId('log-row-Resolver');
    await expect(resolver).toContainText('flow.executeWorkflow');
    await expect(resolver).toContainText('sucesso');
    await expect(resolver.getByTestId('log-sub-execution')).toHaveCount(1);
    await expect(log.getByTestId('log-row-Validar').getByTestId('log-error')).toContainText(
      'campo cpf ausente',
    );
    await expect(log.getByTestId('log-row-Execução')).toBeVisible();

    // Filtros: status e texto.
    await log.getByLabel('Status dos eventos').selectOption('error');
    await expect(log.locator('[data-testid^="log-row-"]')).toHaveCount(2);
    await log.getByLabel('Status dos eventos').selectOption('all');
    await log.getByLabel('Filtrar por nó ou mensagem').fill('resolver');
    await expect(log.locator('[data-testid^="log-row-"]')).toHaveCount(1);

    // .json com as linhas filtradas.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      log.getByRole('button', { name: '.json' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`execucao-${executionId.slice(0, 8)}-log.json`);
    const json = JSON.parse(await readFile(await download.path(), 'utf8')) as {
      execution: { id: string };
      events: { nodeName: string; subExecutions: string[] }[];
    };
    expect(json.execution.id).toBe(executionId);
    expect(json.events.map((e) => e.nodeName)).toEqual(['Resolver']);
    expect(json.events[0]?.subExecutions).toHaveLength(1);

    // A subexecução leva à execução do filho.
    const sub = json.events[0]?.subExecutions[0] ?? '';
    const child = (await editor.call('GET', `/executions/${sub}`)).body as ExecutionDetail;
    expect(child.workflowId).toBe(childId);

    await log.getByRole('link', { name: 'Abrir execução' }).click();
    await expect(page).toHaveURL(new RegExp(`/executions/${executionId}$`));
  });

  test('FR-001/FR-005/SC-002: excluir pede confirmação, remove a execução e some da lista; viewer não vê a opção', async ({
    page,
    browser,
  }) => {
    const wf = await createWorkflow(admin, projectId, 'Para excluir', {
      nodes: [{ id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] }],
      edges: [],
      settings: {},
    });
    const id = await run(wf.id, wf.definition);

    // Viewer: só o log.
    const viewerPage = await browser.newPage();
    await loginViaUi(viewerPage, 'viewer', `/executions?project=${projectId}`);
    const viewerMenu = await openMenu(viewerPage, id);
    await expect(viewerMenu.getByRole('menuitem', { name: 'Log' })).toBeVisible();
    await expect(viewerMenu.getByRole('menuitem', { name: 'Excluir' })).toHaveCount(0);
    await viewerPage.close();

    await loginViaUi(page, 'editor', `/executions?project=${projectId}`);
    const menu = await openMenu(page, id);
    await menu.getByRole('menuitem', { name: 'Excluir' }).click();
    const confirm = page.getByRole('dialog', { name: 'Excluir a execução?' });
    // Cancelar mantém a execução.
    await confirm.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByTestId(`execution-${id}`)).toBeVisible();

    await (await openMenu(page, id)).getByRole('menuitem', { name: 'Excluir' }).click();
    await confirm.getByRole('button', { name: 'Excluir' }).click();
    await expect(page.getByText('Execução excluída')).toBeVisible();
    await expect(page.getByTestId(`execution-${id}`)).toHaveCount(0);
    expect((await editor.call('GET', `/executions/${id}`)).status).toBe(404);
  });
});
