import type {
  ExecutionDetail,
  ProjectSummary,
  TestRunResponse,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let admin: TestUser;
let workflowId: string;

beforeAll(async () => {
  // Timeout curto para o código e memória pequena: os casos maliciosos terminam rápido.
  ctx = await startTestContext({ code: { timeoutMs: 1500, memoryMb: 64 } });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  const project = (
    await admin.call('POST', '/projects', { name: 'Código' })
  ).json<ProjectSummary>();
  workflowId = (
    await admin.call('POST', `/projects/${project.id}/workflows`, { name: 'JS' })
  ).json<WorkflowDetail>().id;
});
afterAll(async () => {
  await ctx.close();
});

const definition = (jsCode: string, mode = 'runOnceForAllItems'): WorkflowDefinition => ({
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'c',
      type: 'code.javascript',
      name: 'Código',
      params: { jsCode, mode },
      position: [200, 0],
    },
  ],
  edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'c', toPort: 'main' }],
  settings: {},
  pinData: { m: [{ json: { q: 2, p: 5 } }, { json: { q: 3, p: 10 } }] },
});

async function run(jsCode: string, mode?: string): Promise<ExecutionDetail> {
  const { executionId } = (
    await admin.call('POST', `/workflows/${workflowId}/test-run`, {
      definition: definition(jsCode, mode),
    })
  ).json<TestRunResponse>();
  for (let i = 0; i < 200; i++) {
    const detail = (await admin.call('GET', `/executions/${executionId}`)).json<ExecutionDetail>();
    if (!['queued', 'running'].includes(detail.status)) return detail;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('execução não terminou');
}
const codeNode = (d: ExecutionDetail) => d.nodes.find((n) => n.nodeId === 'c');

describe('spec 005 — HU-3: código JavaScript pela API', () => {
  it('FR-009/HU-3.1: cada item ganha o campo total; console fica no log do nó', async () => {
    const detail = await run(
      "console.log('itens:', $input.all().length);\nreturn $input.all().map(i => ({ json: { ...i.json, total: i.json.q * i.json.p } }))",
    );
    expect(detail.status).toBe('success');
    expect(codeNode(detail)?.output?.main?.map((i) => i.json.total)).toEqual([10, 30]);
    expect(codeNode(detail)?.console).toEqual(['itens: 2']);
  });

  it('FR-009: modo por item', async () => {
    const detail = await run('return { json: { dobro: $json.q * 2 } }', 'runOnceForEachItem');
    expect(codeNode(detail)?.output?.main?.map((i) => i.json.dobro)).toEqual([4, 6]);
  });

  it('FR-011: retorno inválido gera erro descritivo', async () => {
    const detail = await run('return 42');
    expect(detail.error?.message).toBe('O código deve retornar um objeto ou array de objetos');
  });

  it.each([
    ['while (true) {}', /Tempo limite do código excedido/],
    [
      'const a = []; while (true) a.push(new Array(1e6).fill(1));',
      /Limite de memória do código excedido/,
    ],
    ["return require('child_process')", /require is not defined/],
    ['return process.env', /process is not defined/],
  ])('SC-006/HU-3.2: %s falha com mensagem clara e a API segue estável', async (code, message) => {
    const started = Date.now();
    const detail = await run(code);
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toMatch(message);
    expect(Date.now() - started).toBeLessThan(10_000);
    const health = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
  });
});
