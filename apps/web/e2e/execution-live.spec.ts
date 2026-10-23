import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import type {
  ExecutionSteps,
  TestRunResponse,
  WorkflowDefinition,
  WorkflowNode,
} from '@olly/shared-types';
import { ApiSession, createProject, createWorkflow, loginViaUi } from './support';

let admin: ApiSession;
let editor: ApiSession;
let projectId: string;

const manual: WorkflowNode = {
  id: 'm',
  type: 'trigger.manual',
  name: 'Início',
  params: {},
  position: [0, 0],
};
const wait = (id: string, name: string, seconds: number, x: number): WorkflowNode => ({
  id,
  type: 'flow.wait',
  name,
  params: { resume: 'timeInterval', amount: seconds, unit: 'seconds' },
  position: [x, 0],
});
const chain = (...nodes: WorkflowNode[]): WorkflowDefinition => ({
  nodes,
  edges: nodes.slice(1).map((n, i) => ({
    id: `e${String(i)}`,
    from: nodes[i]?.id ?? '',
    fromPort: 'main',
    to: n.id,
    toPort: 'main',
  })),
  settings: {},
});
const fim: WorkflowNode = {
  id: 'fim',
  type: 'data.set',
  name: 'Fim',
  params: { fields: [{ name: 'ok', type: 'boolean', value: true }] },
  position: [900, 0],
};

/** Dispara uma execução de teste pela API (como o editor), sem esperar terminar. */
async function start(definition: WorkflowDefinition, name: string) {
  const wf = await createWorkflow(admin, projectId, name, definition);
  const res = await editor.call('POST', `/workflows/${wf.id}/test-run`, { definition });
  expect(res.status).toBe(202);
  return { workflow: wf, executionId: (res.body as TestRunResponse).executionId };
}

const steps = async (executionId: string) =>
  (await editor.call('GET', `/executions/${executionId}/steps`)).body as ExecutionSteps;

/** Abre o acompanhamento pela lista de execuções (FR-001). */
async function follow(page: Page, executionId: string) {
  await page.goto(`/executions?project=${projectId}`);
  await page
    .getByTestId(`execution-${executionId}`)
    .getByRole('button', { name: 'Ações da execução' })
    .click();
  await page
    .getByRole('menu', { name: 'Ações da execução' })
    .getByRole('menuitem', { name: 'Acompanhar' })
    .click();
  const log = page.getByTestId('execution-log');
  await expect(log).toBeVisible();
  return log;
}

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

test.describe('spec 029 — acompanhamento ao vivo da execução', () => {
  test('FR-001/FR-002/FR-004/FR-008/SC-001/SC-002: acompanha pela lista, com o nó em andamento, o tempo correndo e o Log completo no fim', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginViaUi(page, 'editor', `/executions?project=${projectId}`);
    const { executionId } = await start(
      chain(manual, wait('a', 'Esperar A', 4, 300), wait('b', 'Esperar B', 4, 600), fim),
      'Ao vivo',
    );
    const log = await follow(page, executionId);
    await expect(log.getByTestId('execution-live')).toBeVisible();
    await expect(log.getByTestId('log-row-Esperar A')).toHaveAttribute('data-status', 'running', {
      timeout: 10_000,
    });
    await expect(log.getByTestId('log-row-Esperar A')).toContainText('em andamento');
    // FR-002: o tempo decorrido corre sem recarregar a página.
    const elapsed = log.getByTestId('execution-elapsed');
    const before = await elapsed.textContent();
    await expect(elapsed).not.toHaveText(before ?? '', { timeout: 3000 });
    await expect(log.getByTestId('execution-progress')).toContainText('de 4 nós já rodaram');
    // Copiar e baixar ficam para o fim (Log incompleto).
    await expect(log.getByRole('button', { name: '.json' })).toBeDisabled();

    // FR-004: o nó termina (sucesso, duração) e o próximo entra em andamento.
    const a = log.getByTestId('log-row-Esperar A');
    await expect(a).toHaveAttribute('data-status', 'success', { timeout: 10_000 });
    await expect(a).toContainText('sucesso');
    await expect(a).toContainText('1 → 1');
    await expect(log.getByTestId('log-row-Esperar B')).toHaveAttribute('data-status', 'running', {
      timeout: 5000,
    });
    // NFR-001/SC-001: entre o início do nó no worker e a tela, menos de 2 s.
    const seenAt = Date.now();
    const b = (await steps(executionId)).running.find((r) => r.nodeId === 'b');
    expect(b).toBeDefined();
    expect(seenAt - Date.parse(b?.startedAt ?? '')).toBeLessThan(2000);

    // FR-008: no fim, o status final, sem "Ao vivo", e o Log completo.
    await expect(log.getByTestId('execution-log-summary')).toContainText(
      'success · teste · manual',
      {
        timeout: 15_000,
      },
    );
    await expect(log.getByTestId('execution-live')).toHaveCount(0);
    await expect(log.getByRole('button', { name: '.json' })).toBeEnabled();
    await expect(log.getByRole('link', { name: 'Abrir execução' })).toBeVisible();
    // SC-002: os passos são os mesmos do Log.
    const final = await steps(executionId);
    await expect(log.locator('[data-testid^="log-row-"]')).toHaveCount(final.steps.length);
    expect(final.steps.map((s) => s.nodeName)).toEqual(['Início', 'Esperar A', 'Esperar B', 'Fim']);
  });

  test('FR-005/FR-006: aberto no meio, mostra os anteriores e o que roda; o erro fica destacado e no topo', async ({
    page,
  }) => {
    await loginViaUi(page, 'editor', `/executions?project=${projectId}`);
    const failing: WorkflowNode = {
      id: 'c',
      type: 'code.javascript',
      name: 'Validar',
      params: { mode: 'runOnceForAllItems', jsCode: "throw new Error('campo cpf ausente');" },
      position: [600, 0],
    };
    const { executionId } = await start(
      chain(manual, wait('w', 'Esperar', 5, 300), failing),
      'Ao vivo com erro',
    );
    // Abre só quando a execução já está no meio (Início concluído, Esperar em andamento).
    await expect
      .poll(async () => (await steps(executionId)).running.map((r) => r.nodeId), {
        timeout: 15_000,
      })
      .toEqual(['w']);
    const log = await follow(page, executionId);
    await expect(log.getByTestId('log-row-Início')).toHaveAttribute('data-status', 'success');
    await expect(log.getByTestId('log-row-Esperar')).toHaveAttribute('data-status', 'running');

    const validar = log.getByTestId('log-row-Validar');
    await expect(validar).toHaveAttribute('data-status', 'error', { timeout: 15_000 });
    await expect(validar.getByTestId('log-error')).toContainText('campo cpf ausente');
    await expect(log.getByTestId('execution-error')).toContainText('campo cpf ausente');
  });

  test('FR-009/SC-003: sem conexão por 10 s, avisa, volta sozinho e termina com os passos do Log', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    // O modo offline do navegador não fecha um WebSocket aberto: a rota derruba e recusa.
    let offline = false;
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket(/socket\.io/, (ws) => {
      if (offline) {
        void ws.close();
        return;
      }
      sockets.push(ws);
      ws.connectToServer();
    });
    await loginViaUi(page, 'editor', `/executions?project=${projectId}`);
    const { executionId } = await start(
      chain(
        manual,
        wait('a', 'Esperar A', 4, 300),
        wait('b', 'Esperar B', 14, 600),
        wait('c', 'Esperar C', 3, 900),
      ),
      'Ao vivo sem rede',
    );
    const log = await follow(page, executionId);
    await expect(log.getByTestId('log-row-Esperar A')).toHaveAttribute('data-status', 'running', {
      timeout: 10_000,
    });

    offline = true;
    await context.setOffline(true);
    for (const ws of sockets.splice(0)) await ws.close();
    await expect(log.getByTestId('execution-live-offline')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(10_000);
    offline = false;
    await context.setOffline(false);
    await expect(log.getByTestId('execution-live-offline')).toHaveCount(0, { timeout: 15_000 });

    await expect(log.getByTestId('execution-log-summary')).toContainText('success', {
      timeout: 30_000,
    });
    const final = await steps(executionId);
    const names = await log
      .locator('[data-testid^="log-row-"]')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-testid')));
    expect(names).toEqual(final.steps.map((s) => `log-row-${s.nodeName}`));
  });

  test('FR-014/SC-004: interrompe com confirmação; o viewer acompanha sem a ação', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const { executionId } = await start(
      chain(manual, wait('w', 'Esperar', 40, 300), fim),
      'Ao vivo para interromper',
    );
    await expect
      .poll(async () => (await steps(executionId)).running.length, { timeout: 15_000 })
      .toBe(1);

    // Viewer: acompanha (execution:read), sem Interromper e sem dados (só metadados).
    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await loginViaUi(viewerPage, 'viewer', `/executions?project=${projectId}`);
    const viewerLog = await follow(viewerPage, executionId);
    await expect(viewerLog.getByTestId('log-row-Esperar')).toHaveAttribute(
      'data-status',
      'running',
    );
    await expect(viewerLog.getByRole('button', { name: 'Interromper' })).toHaveCount(0);
    await viewerContext.close();

    await loginViaUi(page, 'editor', `/executions?project=${projectId}`);
    const log = await follow(page, executionId);
    await log.getByRole('button', { name: 'Interromper' }).click();
    const confirm = page.getByRole('dialog', { name: 'Interromper a execução?' });
    await confirm.getByRole('button', { name: 'Interromper' }).click();
    await expect(log.getByTestId('execution-log-summary')).toContainText('cancelled', {
      timeout: 15_000,
    });
    await expect(log.getByTestId('log-row-Esperar')).toContainText('interrompido');
    await expect(log.getByTestId('log-row-Fim')).toHaveCount(0);
  });

  test('FR-015: o editor mostra "1 em andamento", que abre o acompanhamento e some no fim', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { workflow, executionId } = await start(
      chain(manual, wait('w', 'Esperar', 8, 300), fim),
      'Ao vivo no editor',
    );
    await loginViaUi(page, 'editor', `/workflows/${workflow.id}`);
    const badge = page.getByTestId('running-executions');
    await expect(badge).toHaveText(/1 em andamento/, { timeout: 15_000 });
    await badge.click();
    await page
      .getByRole('menu', { name: 'Execuções em andamento' })
      .getByRole('menuitem')
      .first()
      .click();
    const log = page.getByTestId('execution-log');
    await expect(log.getByRole('heading')).toContainText(executionId.slice(0, 8));
    await expect(log.getByTestId('log-row-Esperar')).toHaveAttribute('data-status', 'running');
    await expect(log.getByTestId('execution-log-summary')).toContainText('success', {
      timeout: 20_000,
    });
    await page.keyboard.press('Escape');
    await expect(badge).toHaveCount(0, { timeout: 15_000 });
  });

  test('FR-011: o link da subexecução ativa abre o acompanhamento dela', async ({ page }) => {
    test.setTimeout(90_000);
    const child = await createWorkflow(
      admin,
      projectId,
      'Filho ao vivo',
      chain(
        { id: 't', type: 'trigger.executeWorkflow', name: 'Chamado', params: {}, position: [0, 0] },
        wait('w', 'Esperar no filho', 10, 300),
      ),
    );
    expect(
      (await admin.call('POST', `/workflows/${child.id}/publish`, { message: 'Filho' })).status,
    ).toBe(200);
    const { executionId } = await start(
      chain(manual, {
        id: 'x',
        type: 'flow.executeWorkflow',
        name: 'Chama',
        params: { workflowId: child.id, mode: 'once' },
        position: [300, 0],
      }),
      'Pai ao vivo',
    );
    await loginViaUi(page, 'editor', `/executions?project=${projectId}`);
    const log = await follow(page, executionId);
    const chama = log.getByTestId('log-row-Chama');
    await expect(chama).toHaveAttribute('data-status', 'running', { timeout: 10_000 });
    const link = chama.getByTestId('log-sub-execution');
    await expect(link).toContainText('ao vivo', { timeout: 20_000 });
    await link.click();
    await expect(log.getByRole('heading')).toContainText('Filho ao vivo');
    await expect(log.getByTestId('execution-live')).toBeVisible();
    await expect(log.getByTestId('log-row-Esperar no filho')).toHaveAttribute(
      'data-status',
      'running',
    );
  });
});
