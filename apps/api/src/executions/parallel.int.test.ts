import type { ProjectSummary, WorkflowDefinition } from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkflow,
  delayNode,
  edge,
  manualNode,
  startDelayServer,
  startTestRun,
  waitForStatus,
  type DelayServer,
} from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let editor: TestUser;
let project: ProjectSummary;
let server: DelayServer;

/** Manual → 3 chamadas HTTP independentes → junção (data.set mantendo os campos). */
const fanOut = (ms: [string, string, string], settings: WorkflowDefinition['settings'] = {}) => ({
  nodes: [
    manualNode(),
    delayNode('h1', server.base, ms[0]),
    delayNode('h2', server.base, ms[1]),
    delayNode('h3', server.base, ms[2]),
    {
      id: 'j',
      type: 'data.set',
      name: 'Junta',
      params: { fields: [], includeOtherFields: true },
      position: [0, 0] as [number, number],
    },
  ],
  edges: [
    edge('m', 'h1'),
    edge('m', 'h2'),
    edge('m', 'h3'),
    edge('h1', 'j'),
    edge('h2', 'j'),
    edge('h3', 'j'),
  ],
  settings,
});

beforeAll(async () => {
  server = await startDelayServer();
  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 },
  });
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'Paralelo' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
});
afterAll(async () => {
  await ctx.close();
  await server.close();
});

describe('spec 006 — FR-006/SC-001: ramos independentes em paralelo', () => {
  it('SC-001: 3 ramos de 1 s terminam em ~1 s', async () => {
    const wf = await createWorkflow(
      editor,
      project.id,
      fanOut(['1000', '1000', '1000'], { maxParallel: 8 }),
    );
    const detail = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(detail.status).toBe('success');
    const branches = detail.nodes.filter((n) => n.nodeId.startsWith('h'));
    const start = Math.min(...branches.map((n) => Date.parse(n.startedAt)));
    const end = Math.max(...branches.map((n) => Date.parse(n.finishedAt ?? '')));
    expect(end - start).toBeGreaterThanOrEqual(950);
    expect(end - start).toBeLessThan(1800);
    expect(server.peak()).toBeGreaterThanOrEqual(3);
  });

  it('FR-006: maxParallel = 1 executa os ramos um de cada vez', async () => {
    const wf = await createWorkflow(
      editor,
      project.id,
      fanOut(['300', '300', '300'], { maxParallel: 1 }),
    );
    const detail = await waitForStatus(editor, await startTestRun(editor, wf));
    const branches = detail.nodes.filter((n) => n.nodeId.startsWith('h'));
    const start = Math.min(...branches.map((n) => Date.parse(n.startedAt)));
    const end = Math.max(...branches.map((n) => Date.parse(n.finishedAt ?? '')));
    expect(end - start).toBeGreaterThanOrEqual(880);
  });
});

describe('spec 006 — FR-008/SC-002: resultado determinístico', () => {
  it('SC-002: 20 execuções seguidas produzem saídas idênticas, com tempos de ramo sorteados', async () => {
    // Cada ramo espera um tempo aleatório: a ordem de conclusão muda a cada execução.
    const random = '{{ Math.floor(Math.random() * 60) }}';
    const def = fanOut([random, random, random], { maxParallel: 8 });
    for (const node of def.nodes) {
      if (node.type === 'http.request') node.params.url = `=${String(node.params.url)}`;
    }
    const wf = await createWorkflow(editor, project.id, def);
    const outputs = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const detail = await waitForStatus(editor, await startTestRun(editor, wf));
      expect(detail.status).toBe('success');
      outputs.add(JSON.stringify(detail.nodes.find((n) => n.nodeId === 'j')?.output));
    }
    expect(outputs.size).toBe(1);
    // Concatenação na ordem das arestas, não na de conclusão.
    const [only] = [...outputs];
    const items = (JSON.parse(only ?? '{}') as { main: { json: { tag: string } }[] }).main;
    expect(items.map((item) => item.json.tag)).toEqual(['h1', 'h2', 'h3']);
  });
});

describe('spec 006 — FR-009/SC-003: itens em paralelo', () => {
  it('SC-003: 20 itens de 500 ms com concorrência 5 levam ~2 s, com a ordem preservada', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ json: { i } }));
    const wf = await createWorkflow(editor, project.id, {
      nodes: [
        manualNode(),
        {
          id: 'p',
          type: 'http.request',
          name: 'Itens',
          params: { method: 'GET', url: `=${server.base}/delay?ms=500&tag=p&i={{ $json.i }}` },
          settings: { parallelItems: { enabled: true, concurrency: 5 } },
          position: [200, 0],
        },
      ],
      edges: [edge('m', 'p')],
      settings: {},
      pinData: { m: items },
    });
    const detail = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(detail.status).toBe('success');
    const node = detail.nodes.find((n) => n.nodeId === 'p');
    const duration = Date.parse(node?.finishedAt ?? '') - Date.parse(node?.startedAt ?? '');
    expect(duration).toBeGreaterThanOrEqual(1900);
    expect(duration).toBeLessThan(3200);
    expect(node?.output?.main?.map((item) => Number(item.json.i))).toEqual(
      items.map((item) => item.json.i),
    );
  });
});
