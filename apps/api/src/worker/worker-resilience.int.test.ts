import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ProjectSummary, WorkflowDetail } from '@olly/shared-types';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/config.js';
import { EXECUTIONS_QUEUE } from '../queue/constants.js';
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

const WORKER_SCRIPT = fileURLToPath(new URL('../testing/worker-process.ts', import.meta.url));

let ctx: TestContext;
let editor: TestUser;
let project: ProjectSummary;
let server: DelayServer;
const children: ChildProcess[] = [];

/** Detecção rápida para o teste: batimento a cada 200 ms, perdido após 1,5 s. */
const queueConfig: AppConfig['queue'] = {
  testRunMode: 'queue',
  workerConcurrency: 1,
  workerShutdownTimeoutMs: 5000,
  workerPort: 0,
  projectMaxConcurrent: 20,
  heartbeatMs: 200,
  staleAfterMs: 1500,
  sweepIntervalMs: 250,
  quotaRetryMs: 200,
};

const slowWorkflow = (ms: number) =>
  createWorkflow(editor, project.id, {
    nodes: [manualNode(), delayNode('h', server.base, ms)],
    edges: [edge('m', 'h')],
    settings: {},
  });

async function waitRunning(executionId: string) {
  return waitForStatus(editor, executionId, (s) => s === 'running');
}

/** Sobe um worker em outro processo (para poder matá-lo). */
async function spawnWorker(): Promise<ChildProcess> {
  const child = fork(WORKER_SCRIPT, [], {
    execArgv: ['--import', 'tsx', '--no-node-snapshot'],
    env: { ...process.env, OLLY_TEST_WORKER_CONFIG: JSON.stringify(ctx.config) },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once('message', () => {
      resolve();
    });
    child.once('exit', (code) => {
      reject(new Error(`worker saiu antes de ficar pronto (${String(code)})`));
    });
  });
  return child;
}

beforeAll(async () => {
  server = await startDelayServer();
  ctx = await startTestContext(
    { queue: queueConfig, http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 } },
    { worker: false },
  );
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'Resiliência' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
});
afterAll(async () => {
  for (const child of children) child.kill('SIGKILL');
  await ctx.close();
  await server.close();
});

describe('spec 006 — FR-004: encerramento gracioso do worker', () => {
  it('FR-004: para de consumir, espera a execução em andamento e deixa a próxima na fila', async () => {
    const worker = await ctx.startWorker();
    const [slow, next] = [await slowWorkflow(1200), await slowWorkflow(10)];
    const first = await startTestRun(editor, slow);
    await waitRunning(first);
    const second = await startTestRun(editor, next);
    const closing = worker.close(10_000);
    // Durante o encerramento, o health check avisa que o worker está saindo.
    const health = await fetch(`http://127.0.0.1:${String(worker.port)}/health`);
    expect(health.status).toBe(503);
    await closing;
    expect((await waitForStatus(editor, first, () => true)).status).toBe('success');
    // Com concorrência 1, a segunda nem começou: continua na fila para outro worker.
    expect((await waitForStatus(editor, second, () => true)).status).toBe('queued');
    const next2 = await ctx.startWorker();
    expect((await waitForStatus(editor, second)).status).toBe('success');
    await next2.close();
  });

  it('FR-004/FR-005: passado o limite, a execução é interrompida como worker_lost e não volta à fila', async () => {
    const worker = await ctx.startWorker();
    const wf: WorkflowDetail = await slowWorkflow(10_000);
    const executionId = await startTestRun(editor, wf);
    await waitRunning(executionId);
    const t0 = Date.now();
    await worker.close(300);
    expect(Date.now() - t0).toBeLessThan(5000);
    const detail = await waitForStatus(editor, executionId);
    expect(detail.status).toBe('error');
    expect(detail.error).toMatchObject({ reason: 'worker_lost' });
    await new Promise((r) => setTimeout(r, 800));
    expect((await waitForStatus(editor, executionId, () => true)).status).toBe('error');
    expect(server.count('h')).toBeGreaterThanOrEqual(1);
  });
});

describe('spec 006 — FR-005/SC-004: worker que cai no meio da execução', () => {
  it('SC-004: worker morto (SIGKILL) gera error/worker_lost e a execução não é reexecutada', async () => {
    const child = await spawnWorker();
    const wf = await createWorkflow(editor, project.id, {
      nodes: [manualNode(), delayNode('morto', server.base, 15_000)],
      edges: [edge('m', 'morto')],
      settings: {},
    });
    const executionId = await startTestRun(editor, wf);
    await waitRunning(executionId);
    await waitForStatus(editor, executionId, () => server.count('morto') === 1);
    child.kill('SIGKILL');

    const t0 = Date.now();
    const detail = await waitForStatus(editor, executionId);
    expect(detail.status).toBe('error');
    expect(detail.error).toMatchObject({ reason: 'worker_lost' });
    // Detectado pela falta de batimento (1,5 s) + varredura.
    expect(Date.now() - t0).toBeLessThan(6000);

    // Mesmo que o job volte a ser entregue, ninguém reexecuta: a execução não está mais na fila.
    const redis = new Redis(ctx.config.redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue(EXECUTIONS_QUEUE, { connection: redis });
    try {
      await queue.add('execution', { executionId }, { jobId: `${executionId}-replay` });
      const replay = await ctx.startWorker();
      await new Promise((r) => setTimeout(r, 1500));
      await replay.close();
    } finally {
      await queue.close();
      redis.disconnect();
    }
    expect((await waitForStatus(editor, executionId, () => true)).status).toBe('error');
    expect(server.count('morto')).toBe(1);
  });
});
