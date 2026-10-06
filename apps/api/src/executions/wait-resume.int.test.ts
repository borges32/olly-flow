import type { ProjectSummary, WorkflowDefinition } from '@olly/shared-types';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXECUTIONS_QUEUE } from '../queue/constants.js';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';
import { ExecutionWaits, type StoredExecutionState } from './waits.service.js';

let ctx: TestContext;
let editor: TestUser;
let project: ProjectSummary;

beforeAll(async () => {
  ctx = await startTestContext({});
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@wait.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@wait.local' });
  project = (await admin.call('POST', '/projects', { name: 'Espera' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
});
afterAll(async () => {
  await ctx.close();
});

const definition: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'a',
      type: 'data.set',
      name: 'Antes',
      params: {
        fields: [{ name: 'antes', type: 'string', value: 'sim' }],
        includeOtherFields: true,
      },
      position: [200, 0],
    },
    {
      id: 'w',
      type: 'flow.wait',
      name: 'Esperar',
      params: { resume: 'timeInterval', amount: 2, unit: 'minutes' },
      position: [400, 0],
    },
    {
      id: 'b',
      type: 'data.set',
      name: 'Depois',
      params: {
        fields: [{ name: 'depois', type: 'string', value: '={{ $json.antes }}-retomado' }],
        includeOtherFields: true,
      },
      position: [600, 0],
    },
  ],
  edges: [
    { id: 'e1', from: 'm', fromPort: 'main', to: 'a', toPort: 'main' },
    { id: 'e2', from: 'a', fromPort: 'main', to: 'w', toPort: 'main' },
    { id: 'e3', from: 'w', fromPort: 'main', to: 'b', toPort: 'main' },
  ],
  settings: {},
};

const state = async (executionId: string) =>
  ctx.database.db
    .selectFrom('execution_state')
    .selectAll()
    .where('execution_id', '=', executionId)
    .executeTakeFirst();

describe('spec 008 — FR-012/NFR-002/SC-005: espera persistida e retomada', () => {
  it('SC-005: espera de 2 min libera o worker e retoma em outro worker', async () => {
    const wf = await createWorkflow(editor, project.id, definition);
    const executionId = await startTestRun(editor, wf);
    const waiting = await waitForStatus(editor, executionId, (s) => s === 'waiting');
    expect(waiting.nodes.find((n) => n.nodeId === 'w')?.status).toBe('waiting');
    expect(waiting.finishedAt).toBeNull();

    // Estado salvo, com a retomada daqui a ~2 min, e o worker livre (NFR-002).
    const saved = await state(executionId);
    const delay = (saved?.resume_at?.getTime() ?? 0) - Date.now();
    expect(delay).toBeGreaterThan(100_000);
    expect(delay).toBeLessThanOrEqual(120_000);
    expect(ctx.worker?.stats().active).toBe(0);

    // O job atrasado da retomada está na fila com o horário salvo.
    const redis = new Redis(ctx.config.redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue(EXECUTIONS_QUEUE, { connection: redis });
    try {
      const job = await queue.getJob(
        `resume-${executionId}-${String(saved?.resume_at?.getTime() ?? 0)}`,
      );
      expect(job?.name).toBe('resume');
      expect(job?.opts.delay).toBeGreaterThan(100_000);
    } finally {
      await queue.close();
      redis.disconnect();
    }

    // O worker original sai; outro assume.
    await ctx.worker?.close(1000);
    const second = await ctx.startWorker();

    // Simula a passagem do tempo: o horário salvo vence agora.
    const stored = saved?.state as StoredExecutionState;
    for (const w of stored.engine.waiting) w.request.resumeAt = new Date().toISOString();
    await ctx.database.db
      .updateTable('execution_state')
      .set({ state: JSON.stringify(stored), resume_at: new Date() })
      .where('execution_id', '=', executionId)
      .execute();
    await ctx.app.get(ExecutionWaits).schedule(executionId);

    const done = await waitForStatus(editor, executionId, (s) => s === 'success');
    expect(done.nodes.find((n) => n.nodeId === 'b')?.output?.main?.[0]?.json).toEqual({
      antes: 'sim',
      depois: 'sim-retomado',
    });
    // Uma linha final por nó (a de espera deu lugar à final) e o estado descartado.
    expect(done.nodes.filter((n) => n.nodeId === 'w').map((n) => n.status)).toEqual(['success']);
    expect(await state(executionId)).toBeUndefined();
    expect(second.stats().processed).toBeGreaterThanOrEqual(1);
  });

  it('FR-012: a varredura reagenda a retomada vencida mesmo sem o job atrasado', async () => {
    const wf = await createWorkflow(editor, project.id, definition);
    const executionId = await startTestRun(editor, wf);
    await waitForStatus(editor, executionId, (s) => s === 'waiting');
    const saved = await state(executionId);
    const stored = saved?.state as StoredExecutionState;
    for (const w of stored.engine.waiting) w.request.resumeAt = new Date().toISOString();
    await ctx.database.db
      .updateTable('execution_state')
      .set({ state: JSON.stringify(stored), resume_at: new Date(Date.now() - 1000) })
      .where('execution_id', '=', executionId)
      .execute();
    expect(await ctx.app.get(ExecutionWaits).sweepDue()).toBeGreaterThanOrEqual(1);
    expect((await waitForStatus(editor, executionId, (s) => s === 'success')).status).toBe(
      'success',
    );
  });

  it('FR-012: cancelar uma execução em espera encerra e descarta o estado', async () => {
    const wf = await createWorkflow(editor, project.id, definition);
    const executionId = await startTestRun(editor, wf);
    await waitForStatus(editor, executionId, (s) => s === 'waiting');
    expect((await editor.call('POST', `/executions/${executionId}/cancel`)).statusCode).toBe(202);
    const cancelled = await waitForStatus(editor, executionId, (s) => s === 'cancelled');
    expect(cancelled.nodes.find((n) => n.nodeId === 'w')?.status).toBe('cancelled');
    expect(await state(executionId)).toBeUndefined();
  });
});
