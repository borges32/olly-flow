import { expect, test } from '@playwright/test';
import type { WorkflowDefinition } from '@olly/shared-types';
import { createProject, createWorkflow, loginViaUi } from './support';

test('spec 002 — NFR-001: canvas com 100 nós mantém ≥ 30 fps ao arrastar', async ({ page }) => {
  const { project, admin } = await createProject({ editor: 'editor' });
  const nodes = Array.from({ length: 100 }, (_, i) => ({
    id: `n${i}`,
    type: i === 0 ? 'trigger.manual' : 'data.set',
    name: i === 0 ? 'Início' : `Campo ${i}`,
    params: i === 0 ? {} : { fields: [{ name: `c${i}`, type: 'string', value: 'x' }] },
    position: [(i % 10) * 240, Math.floor(i / 10) * 120] as [number, number],
  }));
  const edges = nodes
    .slice(1)
    .map((n, i) => ({ id: `e${i}`, from: `n${i}`, fromPort: 'main', to: n.id, toPort: 'main' }));
  const definition: WorkflowDefinition = { nodes, edges, settings: {} };
  const wf = await createWorkflow(admin, project.id, 'Cem nós', definition);
  await admin.dispose();

  await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(100);
  const box = await page.getByTestId('node-Campo 55').boundingBox();
  if (!box) throw new Error('nó não encontrado');

  await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __start: number; __stop: boolean };
    w.__frames = 0;
    w.__stop = false;
    w.__start = performance.now();
    const tick = () => {
      if (w.__stop) return;
      w.__frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 4, box.y + box.height / 2 + i * 2);
  }
  await page.mouse.up();
  const fps = await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __start: number; __stop: boolean };
    w.__stop = true;
    return (w.__frames * 1000) / (performance.now() - w.__start);
  });
  console.log(`NFR-001: ${fps.toFixed(1)} fps arrastando com 100 nós`);
  expect(fps).toBeGreaterThanOrEqual(30);
});
