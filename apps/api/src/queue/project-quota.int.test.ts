import type { ProjectSummary, QueueStats } from '@olly/shared-types';
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
let admin: TestUser, editor: TestUser, viewer: TestUser;
let project: ProjectSummary;
let server: DelayServer;

const stats = async (user = viewer) =>
  (await user.call('GET', `/projects/${project.id}/queue-stats`)).json<QueueStats>();

beforeAll(async () => {
  server = await startDelayServer();
  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 },
  });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'Cota' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'admin' });
  await admin.call('PUT', `/projects/${project.id}/members/${viewer.id}`, { role: 'viewer' });
});
afterAll(async () => {
  await ctx.close();
  await server.close();
});

describe('spec 006 — FR-012: cota de execuções simultâneas por projeto', () => {
  it('FR-012: só a administração da plataforma altera a cota; a mudança é auditada', async () => {
    expect(await stats()).toEqual({ running: 0, queued: 0, limit: 20, customLimit: false });
    // Admin do projeto (não da plataforma) não muda a cota.
    const denied = await editor.call('PUT', `/projects/${project.id}/quota`, {
      maxConcurrentExecutions: 100,
    });
    expect(denied.statusCode).toBe(403);
    expect(
      (await admin.call('PUT', `/projects/${project.id}/quota`, { maxConcurrentExecutions: 0 }))
        .statusCode,
    ).toBe(400);
    expect(
      (await admin.call('PUT', `/projects/${project.id}/quota`, { maxConcurrentExecutions: 2 }))
        .statusCode,
    ).toBe(204);
    expect(await stats()).toMatchObject({ limit: 2, customLimit: true });
    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select('details')
      .where('entity_id', '=', project.id)
      .where('action', '=', 'project.quota')
      .executeTakeFirstOrThrow();
    expect(audit.details).toEqual({ from: null, to: 2 });
  });

  it('SC-006: com cota 2, a 3ª execução fica na fila até abrir uma vaga', async () => {
    const wf = await createWorkflow(editor, project.id, {
      nodes: [manualNode(), delayNode('cota', server.base, 1500)],
      edges: [edge('m', 'cota')],
      settings: {},
    });
    const ids = [
      await startTestRun(editor, wf),
      await startTestRun(editor, wf),
      await startTestRun(editor, wf),
    ];
    await waitForStatus(editor, ids[0] ?? '', (s) => s === 'running');
    await waitForStatus(editor, ids[1] ?? '', (s) => s === 'running');
    await new Promise((r) => setTimeout(r, 500));
    expect(await stats()).toEqual({ running: 2, queued: 1, limit: 2, customLimit: true });
    expect((await waitForStatus(editor, ids[2] ?? '', () => true)).status).toBe('queued');
    expect(server.peak()).toBe(2);

    const done = await Promise.all(ids.map((id) => waitForStatus(editor, id)));
    expect(done.map((d) => d.status)).toEqual(['success', 'success', 'success']);
    // A 3ª só começou depois que uma das duas primeiras terminou.
    const firstEnd = Math.min(
      ...done.slice(0, 2).map((d) => Date.parse(d.nodes[1]?.finishedAt ?? '')),
    );
    expect(Date.parse(done[2]?.nodes[1]?.startedAt ?? '')).toBeGreaterThanOrEqual(firstEnd - 50);
    expect(server.peak()).toBe(2);
    expect(await stats()).toMatchObject({ running: 0, queued: 0 });
  });

  it('FR-012: null volta ao padrão da plataforma', async () => {
    await admin.call('PUT', `/projects/${project.id}/quota`, { maxConcurrentExecutions: null });
    expect(await stats()).toMatchObject({ limit: 20, customLimit: false });
  });
});
