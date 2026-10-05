import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  Edge,
  ExecutionDetail,
  ExecutionStatus,
  TestRunResponse,
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowNode,
} from '@olly/shared-types';
import type { TestUser } from './test-app.js';

/** Espera a execução sair de `queued`/`running` (ou atingir um dos status pedidos). */
export async function waitForStatus(
  user: TestUser,
  executionId: string,
  done: (status: ExecutionStatus) => boolean = (s) => !['queued', 'running'].includes(s),
  timeoutMs = 20_000,
): Promise<ExecutionDetail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const detail = (await user.call('GET', `/executions/${executionId}`)).json<ExecutionDetail>();
    if (done(detail.status)) return detail;
    if (Date.now() > deadline) {
      throw new Error(`execução ${executionId} ainda está ${detail.status}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function createWorkflow(
  user: TestUser,
  projectId: string,
  definition: WorkflowDefinition,
): Promise<WorkflowDetail> {
  return (
    await user.call('POST', `/projects/${projectId}/workflows`, {
      name: `wf ${Math.random().toString(36).slice(2)}`,
      definition,
    })
  ).json<WorkflowDetail>();
}

export async function startTestRun(
  user: TestUser,
  workflow: WorkflowDetail,
  definition: WorkflowDefinition = workflow.definition,
): Promise<string> {
  const res = await user.call('POST', `/workflows/${workflow.id}/test-run`, { definition });
  if (res.statusCode !== 202) throw new Error(`test-run: ${res.statusCode} ${res.body}`);
  return res.json<TestRunResponse>().executionId;
}

export const manualNode = (id = 'm'): WorkflowNode => ({
  id,
  type: 'trigger.manual',
  name: id,
  params: {},
  position: [0, 0],
});

/** `http.request` para o servidor lento: `GET <base>/delay?ms=<ms>&tag=<tag>`. */
export const delayNode = (
  id: string,
  base: string,
  ms: number | string,
  extra: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id,
  type: 'http.request',
  name: id,
  params: { method: 'GET', url: `${base}/delay?ms=${String(ms)}&tag=${id}` },
  position: [0, 0],
  ...extra,
});

export const edge = (from: string, to: string): Edge => ({
  id: `${from}-${to}`,
  from,
  fromPort: 'main',
  to,
  toPort: 'main',
});

/** Servidor HTTP local: `/delay?ms=` responde depois de `ms` com `{ tag, i }`. */
export interface DelayServer {
  base: string;
  /** Requisições em andamento agora e o pico observado. */
  inFlight(): number;
  peak(): number;
  /** Requisições recebidas por `tag`. */
  count(tag: string): number;
  close(): Promise<void>;
}

export async function startDelayServer(): Promise<DelayServer> {
  let active = 0;
  let peak = 0;
  const counts = new Map<string, number>();
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const ms = Number(url.searchParams.get('ms') ?? 0);
    const tag = url.searchParams.get('tag') ?? '';
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
    active++;
    peak = Math.max(peak, active);
    const timer = setTimeout(() => {
      active--;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ tag: url.searchParams.get('tag'), i: url.searchParams.get('i') }));
    }, ms);
    req.on('close', () => {
      if (!res.writableEnded) {
        clearTimeout(timer);
        active--;
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    inFlight: () => active,
    peak: () => peak,
    count: (tag) => counts.get(tag) ?? 0,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
