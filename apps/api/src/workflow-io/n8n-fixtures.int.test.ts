import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ExecutionDetail,
  ImportPreview,
  Item,
  ProjectSummary,
  TestRunResponse,
  WorkflowDetail,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

/**
 * Spec 015, FR-027/SC-007/SC-008: todas as fixtures exportadas do N8N são importadas pela API
 * (formato N8N); as sem pendências executam com a entrada do caso e a saída é comparada com a
 * esperada. O relatório consolidado fica em docs/migracao/relatorio-fixtures-n8n.md (o teste
 * falha se divergir; regenere com OLLY_UPDATE_MIGRATION_REPORT=1).
 */
const root = fileURLToPath(new URL('../../../../fixtures/n8n', import.meta.url));
const REPORT = fileURLToPath(
  new URL('../../../../docs/migracao/relatorio-fixtures-n8n.md', import.meta.url),
);
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const cases = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'workflow.json')))
  .map((d) => d.name)
  .sort();

let ctx: TestContext;
let admin: TestUser;
let projectId: string;
const rows: {
  name: string;
  nodes: number;
  unsupported: number;
  pending: number;
  review: number;
  result: string;
}[] = [];

beforeAll(async () => {
  ctx = await startTestContext();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  projectId = (await admin.call('POST', '/projects', { name: 'Migração' })).json<ProjectSummary>()
    .id;
});
afterAll(async () => {
  await ctx.close();
});

async function run(wf: WorkflowDetail, name: string): Promise<string> {
  const input = read(join(root, name, 'input.json')) as { trigger: string; items: Item[] };
  const expected = read(join(root, name, 'expected.json')) as Record<
    string,
    Record<string, Item[]>
  >;
  const trigger = wf.definition.nodes.find((n) => n.name === input.trigger);
  expect(trigger, 'gatilho do caso').toBeDefined();
  const { executionId } = (
    await admin.call('POST', `/workflows/${wf.id}/test-run`, {
      definition: wf.definition,
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
  return 'saída igual à esperada';
}

describe('spec 015 — FR-027/SC-007/SC-008: fixtures do N8N importadas pela API', () => {
  it.each(cases)(
    'SC-007/SC-008: %s é importada e, sem pendências, reproduz a saída esperada',
    async (name) => {
      const content = read(join(root, name, 'workflow.json'));
      const res = await admin.call('POST', `/projects/${projectId}/workflows/import`, {
        format: 'n8n',
        content,
      });
      expect(res.statusCode, res.body).toBe(201);
      const { workflow, preview } = res.json<{
        workflow: WorkflowDetail;
        preview: ImportPreview;
      }>();
      const unsupported = preview.migration?.nodes.unsupported.length ?? 0;
      const pending = preview.pending.length;
      let result = 'pendências: não executada';
      if (unsupported === 0 && pending === 0 && existsSync(join(root, name, 'expected.json'))) {
        result = await run(workflow, name);
      }
      rows.push({
        name,
        nodes: preview.counts.nodes,
        unsupported,
        pending,
        review: preview.migration?.expressionsToReview.length ?? 0,
        result,
      });
    },
  );

  it('FR-027: relatório consolidado (100% das fixtures importadas)', () => {
    expect(rows.map((r) => r.name).sort()).toEqual(cases);
    const lines = [
      '# Relatório de migração das fixtures do N8N',
      '',
      '> Gerado por `apps/api/src/workflow-io/n8n-fixtures.int.test.ts` (spec 015, FR-027). Não edite à mão: regenere com `OLLY_UPDATE_MIGRATION_REPORT=1 pnpm --filter @olly/api test:integration`.',
      '',
      `Fixtures importadas: ${String(rows.length)} de ${String(cases.length)} (${cases.length === 0 ? '—' : `${String(Math.round((rows.length / cases.length) * 100))}%`}).`,
      '',
      '| Fixture | Nós | Não suportados | Pendências | Expressões a revisar | Resultado |',
      '|---|---|---|---|---|---|',
      ...[...rows]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (r) =>
            `| ${r.name} | ${String(r.nodes)} | ${String(r.unsupported)} | ${String(r.pending)} | ${String(r.review)} | ${r.result} |`,
        ),
      '',
    ];
    const text = lines.join('\n');
    if (process.env.OLLY_UPDATE_MIGRATION_REPORT === '1' || !existsSync(REPORT)) {
      mkdirSync(dirname(REPORT), { recursive: true });
      writeFileSync(REPORT, text);
    }
    expect(readFileSync(REPORT, 'utf8')).toBe(text);
  });
});
