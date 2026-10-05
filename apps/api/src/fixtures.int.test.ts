import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ExecutionDetail,
  Item,
  ProjectSummary,
  TestRunResponse,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from './testing/test-app.js';

/**
 * Spec 005, FR-018/SC-001: cada fixture com equivalente Olly roda pela API real (task runner,
 * expressões, código), com a entrada do caso fixada no gatilho, e a saída por nó é comparada.
 * Os workflows reais da POC ainda não foram exportados: hoje só há casos sintéticos.
 */
const root = fileURLToPath(new URL('../../../fixtures', import.meta.url));
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const cases = readdirSync(join(root, 'n8n'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, 'olly', d.name, 'workflow.json')))
  .map((d) => d.name);

let ctx: TestContext;
let admin: TestUser;
let projectId: string;

beforeAll(async () => {
  ctx = await startTestContext();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  projectId = (await admin.call('POST', '/projects', { name: 'Fixtures' })).json<ProjectSummary>()
    .id;
});
afterAll(async () => {
  await ctx.close();
});

describe('spec 005 — FR-018/SC-001: fixtures recriadas, executadas pela API', () => {
  it('FR-018: há fixtures aplicáveis (sintéticas enquanto a POC não for exportada)', () => {
    expect(cases).toEqual(expect.arrayContaining(['exemplo-set-if', 'exemplo-webhook-code']));
  });

  it.each(cases)('FR-018: %s produz a saída esperada', async (name) => {
    const definition = read(join(root, 'olly', name, 'workflow.json')) as WorkflowDefinition;
    const input = read(join(root, 'n8n', name, 'input.json')) as { trigger: string; items: Item[] };
    const expected = read(join(root, 'n8n', name, 'expected.json')) as Record<
      string,
      Record<string, Item[]>
    >;
    const trigger = definition.nodes.find((n) => n.name === input.trigger);
    expect(trigger, 'gatilho do caso').toBeDefined();
    const wf = (
      await admin.call('POST', `/projects/${projectId}/workflows`, { name, definition })
    ).json<WorkflowDetail>();
    // A entrada do caso substitui a saída do gatilho (equivale a pin data; fixtures/n8n/README.md).
    const { executionId } = (
      await admin.call('POST', `/workflows/${wf.id}/test-run`, {
        definition,
        pinData: { [trigger?.id ?? '']: input.items },
      })
    ).json<TestRunResponse>();
    let detail: ExecutionDetail | undefined;
    for (let i = 0; i < 200 && (!detail || ['queued', 'running'].includes(detail.status)); i++) {
      await new Promise((r) => setTimeout(r, 50));
      detail = (await admin.call('GET', `/executions/${executionId}`)).json<ExecutionDetail>();
    }
    expect(detail?.status, detail?.error?.message).toBe('success');
    for (const [nodeName, ports] of Object.entries(expected)) {
      const node = detail?.nodes.find((n) => n.nodeName === nodeName);
      expect(node, `nó ${nodeName}`).toBeDefined();
      for (const [port, items] of Object.entries(ports)) {
        expect(
          (node?.output?.[port] ?? []).map((i) => i.json),
          `${nodeName}.${port}`,
        ).toEqual(items.map((i) => i.json));
      }
    }
  });
});
