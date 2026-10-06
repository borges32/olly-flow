import type {
  CredentialSummary,
  ExecutionDetail,
  ProjectSummary,
  WorkflowDetail,
} from '@olly/shared-types';
import { sql } from 'kysely';
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
let admin: TestUser, editor: TestUser, viewer: TestUser, outsider: TestUser;
let project: ProjectSummary;
let server: DelayServer;
let pgCredentialId: string;

const pgSleeping = async () => {
  const { rows } = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE query LIKE 'SELECT pg_sleep(30)%' AND state = 'active'`.execute(ctx.database.db);
  return rows[0]?.n ?? 0;
};

async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<number> {
  const t0 = Date.now();
  while (!(await check())) {
    if (Date.now() - t0 > timeoutMs) throw new Error('condição não atingida');
    await new Promise((r) => setTimeout(r, 50));
  }
  return Date.now() - t0;
}

beforeAll(async () => {
  server = await startDelayServer();
  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1', 'localhost'], maxResponseBytes: 1024 * 1024 },
    execution: {
      expressionTimeoutMs: 1000,
      isolateMemoryMb: 64,
      nodeDataMaxBytes: 1_048_576,
      timezone: 'UTC',
      // FR-011: timeout global padrão curto, para o teste.
      workflowTimeoutMs: 4000,
      defaultMaxParallel: 8,
      maxLoopIterations: 10_000,
      maxSubworkflowDepth: 5,
    },
  });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@t.local' });
  outsider = await loginAs(ctx, { sub: 'outsider', email: 'outsider@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'Cancelar' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  await admin.call('PUT', `/projects/${project.id}/members/${viewer.id}`, { role: 'viewer' });
  const c = ctx.database.container;
  pgCredentialId = (
    await editor.call('POST', `/projects/${project.id}/credentials`, {
      name: 'Banco',
      type: 'postgres',
      data: {
        host: c.getHost(),
        port: c.getPort(),
        database: c.getDatabase(),
        user: c.getUsername(),
        password: c.getPassword(),
      },
    })
  ).json<CredentialSummary>().id;
});
afterAll(async () => {
  await ctx.close();
  await server.close();
});

const cancel = (user: TestUser, executionId: string) =>
  user.call('POST', `/executions/${executionId}/cancel`);

describe('spec 006 — FR-010/SC-005/NFR-001: cancelamento', () => {
  it('SC-005: cancelar interrompe o pg_sleep no banco em até 2 s', async () => {
    const wf = await createWorkflow(editor, project.id, {
      nodes: [
        manualNode(),
        {
          id: 'q',
          type: 'postgres.query',
          name: 'Dorme',
          params: { query: 'SELECT pg_sleep(30)' },
          credentialId: pgCredentialId,
          position: [200, 0],
        },
      ],
      edges: [edge('m', 'q')],
      settings: {},
    });
    const executionId = await startTestRun(editor, wf);
    await until(async () => (await pgSleeping()) === 1);

    const t0 = Date.now();
    const res = await cancel(editor, executionId);
    expect(res.statusCode).toBe(202);
    const detail = await waitForStatus(editor, executionId);
    const statusMs = Date.now() - t0;
    const dbMs = await until(async () => (await pgSleeping()) === 0, 2000);
    expect(detail.status).toBe('cancelled');
    expect(detail.error).toMatchObject({ reason: 'cancelled' });
    expect(detail.error?.message).toContain('Execução cancelada por');
    expect(detail.nodes.find((n) => n.nodeId === 'q')?.status).toBe('cancelled');
    expect(statusMs).toBeLessThan(2000);
    expect(statusMs + dbMs).toBeLessThan(2000);

    // Auditado; cancelar de novo é conflito.
    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select(['action', 'user_id'])
      .where('entity_id', '=', executionId)
      .execute();
    expect(audit).toContainEqual({ action: 'execution.cancel', user_id: editor.id });
    expect((await cancel(editor, executionId)).statusCode).toBe(409);
  });

  it('FR-010: execução na fila é cancelada na hora e nunca começa', async () => {
    // Cota 1: a segunda execução fica na fila atrás da primeira.
    await admin.call('PUT', `/projects/${project.id}/quota`, { maxConcurrentExecutions: 1 });
    try {
      const wf = await createWorkflow(editor, project.id, {
        nodes: [manualNode(), delayNode('fila', server.base, 1500)],
        edges: [edge('m', 'fila')],
        settings: {},
      });
      const first = await startTestRun(editor, wf);
      await waitForStatus(editor, first, (s) => s === 'running');
      const second = await startTestRun(editor, wf);
      await new Promise((r) => setTimeout(r, 300));
      expect((await waitForStatus(editor, second, () => true)).status).toBe('queued');
      expect((await cancel(editor, second)).statusCode).toBe(202);
      const detail = await waitForStatus(editor, second, () => true);
      expect(detail.status).toBe('cancelled');
      expect(detail.nodes).toEqual([]);
      expect((await waitForStatus(editor, first)).status).toBe('success');
      expect(server.count('fila')).toBe(1);
    } finally {
      await admin.call('PUT', `/projects/${project.id}/quota`, { maxConcurrentExecutions: null });
    }
  });

  it('FR-010: só quem pode executar cancela; quem não é do projeto nem enxerga', async () => {
    const wf: WorkflowDetail = await createWorkflow(editor, project.id, {
      nodes: [manualNode(), delayNode('rbac', server.base, 3000)],
      edges: [edge('m', 'rbac')],
      settings: {},
    });
    const executionId = await startTestRun(editor, wf);
    expect((await cancel(viewer, executionId)).statusCode).toBe(403);
    expect((await cancel(outsider, executionId)).statusCode).toBe(404);
    expect((await cancel(editor, executionId)).statusCode).toBe(202);
    expect((await waitForStatus(editor, executionId)).status).toBe('cancelled');
  });
});

describe('spec 006 — FR-011: timeout global', () => {
  it('FR-011: settings.timeoutSec do workflow cancela com motivo timeout', async () => {
    const wf = await createWorkflow(editor, project.id, {
      nodes: [manualNode(), delayNode('t1', server.base, 10_000)],
      edges: [edge('m', 't1')],
      settings: { timeoutSec: 1 },
    });
    const t0 = Date.now();
    const detail: ExecutionDetail = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(detail.status).toBe('cancelled');
    expect(detail.error).toMatchObject({
      reason: 'timeout',
      message: 'Tempo limite da execução excedido (1 s)',
    });
  });

  it('FR-011: sem timeout no workflow, vale o padrão da plataforma (OLLY_DEFAULT_WORKFLOW_TIMEOUT)', async () => {
    const wf = await createWorkflow(editor, project.id, {
      nodes: [manualNode(), delayNode('t2', server.base, 10_000)],
      edges: [edge('m', 't2')],
      settings: {},
    });
    const detail = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(detail.status).toBe('cancelled');
    expect(detail.error).toMatchObject({
      reason: 'timeout',
      message: 'Tempo limite da execução excedido (4 s)',
    });
  });
});
