import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import type { WorkflowDefinition } from '@olly/shared-types';
import { createProject, createWorkflow, loginViaUi, type ApiSession } from './support';

let admin: ApiSession;
let projectId: string;
let server: Server;
let base: string;

test.beforeAll(async () => {
  ({
    admin,
    project: { id: projectId },
  } = await createProject({ editor: 'editor' }));
  // API lenta local (liberada pela allowlist do anti-SSRF no ambiente E2E).
  server = createServer((req, res) => {
    const ms = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('ms') ?? 0);
    const timer = setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    }, ms);
    req.on('close', () => {
      clearTimeout(timer);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await admin.dispose();
});

const status = (page: Page, name: string) =>
  page.getByTestId(`node-${name}`).getByTestId('node-status');

const parallel = (ms: number): WorkflowDefinition => ({
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    ...['A', 'B'].map((name, i) => ({
      id: name.toLowerCase(),
      type: 'http.request',
      name: `Lento ${name}`,
      params: { method: 'GET', url: `${base}/?ms=${String(ms)}&n=${name}` },
      position: [300, i * 160 - 80] as [number, number],
    })),
  ],
  edges: [
    { id: 'e1', from: 'm', fromPort: 'main', to: 'a', toPort: 'main' },
    { id: 'e2', from: 'm', fromPort: 'main', to: 'b', toPort: 'main' },
  ],
  settings: {},
});

test.describe('spec 006 — FR-013/FR-010: execução paralela no editor', () => {
  test('FR-013: nós simultâneos, arestas animadas e linha do tempo', async ({ page }) => {
    const wf = await createWorkflow(admin, projectId, 'Paralelo E2E', parallel(2500));
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByRole('button', { name: 'Executar workflow' }).click();

    // Os dois ramos executam ao mesmo tempo, com as arestas animadas.
    await expect(status(page, 'Lento A')).toHaveAttribute('data-status', 'running');
    await expect(status(page, 'Lento B')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('.react-flow__edge.animated')).toHaveCount(2);
    await page.getByRole('button', { name: 'Linha do tempo' }).click();
    await expect(page.getByTestId('execution-timeline')).toBeVisible();

    await expect(status(page, 'Lento A')).toHaveAttribute('data-status', 'success', {
      timeout: 15_000,
    });
    await expect(status(page, 'Lento B')).toHaveAttribute('data-status', 'success');
    await expect(page.locator('.react-flow__edge.animated')).toHaveCount(0);

    // Barras sobrepostas no tempo: os dois começam juntos e duram ~2,5 s.
    const bar = (name: string) => page.getByTestId(`timeline-row-${name}`).locator('rect');
    for (const name of ['Lento A', 'Lento B']) {
      await expect(bar(name)).toBeVisible();
      expect(Number(await bar(name).getAttribute('data-duration'))).toBeGreaterThanOrEqual(2400);
    }
    const startA = Number(await bar('Lento A').getAttribute('data-start'));
    const startB = Number(await bar('Lento B').getAttribute('data-start'));
    expect(Math.abs(startA - startB)).toBeLessThan(1000);
  });

  test('FR-010: "Parar execução" interrompe os nós em andamento', async ({ page }) => {
    const wf = await createWorkflow(admin, projectId, 'Parar E2E', parallel(30_000));
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(status(page, 'Lento A')).toHaveAttribute('data-status', 'running');
    await page.getByRole('button', { name: 'Parar execução' }).click();
    await expect(page.getByText('Execução interrompida')).toBeVisible({ timeout: 5000 });
    await expect(status(page, 'Lento A')).toHaveAttribute('data-status', 'cancelled');
    await expect(status(page, 'Lento B')).toHaveAttribute('data-status', 'cancelled');
    await expect(page.getByRole('button', { name: 'Parar execução' })).toBeHidden();

    // Na lista, a execução aparece cancelada e o projeto mostra a ocupação da fila.
    await page.goto(`/executions?project=${projectId}`);
    await expect(page.getByTestId('queue-stats')).toContainText('na fila');
    await expect(
      page.getByTestId('executions-table').locator('[data-status="cancelled"]').first(),
    ).toBeVisible();
  });
});
