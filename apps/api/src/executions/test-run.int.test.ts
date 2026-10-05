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
let editor: TestUser, viewer: TestUser, executor: TestUser, outsider: TestUser;
let workflow: WorkflowDetail;

const manual = {
  id: 'm',
  type: 'trigger.manual',
  name: 'Início',
  params: {},
  position: [0, 0] as [number, number],
};
const busca = {
  id: 'busca',
  type: 'data.set',
  name: 'Busca',
  params: {
    fields: [
      { name: 'id', type: 'number', value: '={{ $itemIndex + 1 }}' },
      { name: 'idade', type: 'number', value: '={{ $json.idade }}' },
    ],
  },
  position: [200, 0] as [number, number],
};
const se = {
  id: 'se',
  type: 'logic.if',
  name: 'Adulto?',
  params: {
    conditions: {
      combinator: 'and',
      conditions: [
        {
          leftValue: '={{ $json.idade }}',
          rightValue: '18',
          operator: { type: 'number', operation: 'gte' },
        },
      ],
    },
  },
  position: [400, 0] as [number, number],
};
const saida = {
  id: 'saida',
  type: 'data.set',
  name: 'Saudação',
  params: {
    fields: [{ name: 'msg', type: 'string', value: "=Olá, cliente {{ $('Busca').item.json.id }}" }],
  },
  position: [600, 0] as [number, number],
};
const e = (from: string, to: string, fromPort = 'main') => ({
  id: `${from}-${to}`,
  from,
  fromPort,
  to,
  toPort: 'main',
});
const definition: WorkflowDefinition = {
  nodes: [manual, busca, se, saida],
  edges: [e('m', 'busca'), e('busca', 'se'), e('se', 'saida', 'true')],
  settings: {},
  pinData: { m: [{ json: { idade: 12 } }, { json: { idade: 40 } }, { json: { idade: 22 } }] },
};

async function waitFinished(user: TestUser, executionId: string): Promise<ExecutionDetail> {
  for (let i = 0; i < 100; i++) {
    const detail = (await user.call('GET', `/executions/${executionId}`)).json<ExecutionDetail>();
    if (!['queued', 'running'].includes(detail.status)) return detail;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('execução não terminou');
}

async function testRun(user: TestUser, body: object) {
  return user.call('POST', `/workflows/${workflow.id}/test-run`, body);
}

beforeAll(async () => {
  process.env.OLLY_EXPOSED_SAUDACAO = 'oi';
  ctx = await startTestContext();
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@t.local' });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@t.local' });
  outsider = await loginAs(ctx, { sub: 'outsider', email: 'outsider@t.local' });
  const project = (await admin.call('POST', '/projects', { name: 'P' })).json<ProjectSummary>();
  for (const [u, role] of [
    [editor, 'editor'],
    [viewer, 'viewer'],
    [executor, 'executor'],
  ] as const) {
    await admin.call('PUT', `/projects/${project.id}/members/${u.id}`, { role });
  }
  workflow = (
    await editor.call('POST', `/projects/${project.id}/workflows`, { name: 'Clientes' })
  ).json<WorkflowDetail>();
});
afterAll(async () => {
  delete process.env.OLLY_EXPOSED_SAUDACAO;
  await ctx.close();
});

describe('spec 003 — FR-011/FR-014: execução de teste e log', () => {
  it('FR-011: executa a definição não salva e registra execução e nós', async () => {
    const res = await testRun(editor, { definition });
    expect(res.statusCode).toBe(202);
    const { executionId } = res.json<TestRunResponse>();
    const detail = await waitFinished(editor, executionId);

    expect(detail).toMatchObject({
      status: 'success',
      mode: 'test',
      triggerType: 'manual',
      triggeredBy: editor.id,
      workflowId: workflow.id,
      workflowVersion: 1,
      error: null,
    });
    expect(detail.finishedAt).not.toBeNull();
    const byName = Object.fromEntries(detail.nodes.map((n) => [n.nodeName, n]));
    expect(Object.keys(byName).sort()).toEqual(['Adulto?', 'Busca', 'Início', 'Saudação']);
    expect(byName['Início']).toMatchObject({ status: 'success', pinned: true, itemsOut: 3 });
    expect(byName['Adulto?']).toMatchObject({ itemsIn: 3, itemsOut: 3 });
    expect(byName['Adulto?']?.output?.true?.map((i) => i.json.id)).toEqual([2, 3]);
    expect(byName['Saudação']?.output?.main?.map((i) => i.json.msg)).toEqual([
      'Olá, cliente 2',
      'Olá, cliente 3',
    ]);
    expect(byName['Saudação']?.input?.main).toHaveLength(2);
  });

  it('FR-011: destinationNodeId executa só até o nó escolhido', async () => {
    const { executionId } = (
      await testRun(editor, { definition, destinationNodeId: 'busca' })
    ).json<TestRunResponse>();
    const detail = await waitFinished(editor, executionId);
    expect(detail.nodes.map((n) => n.nodeName).sort()).toEqual(['Busca', 'Início']);
  });

  it('FR-016: pinData do corpo substitui a execução do nó', async () => {
    const { executionId } = (
      await testRun(editor, {
        definition,
        pinData: { ...definition.pinData, busca: [{ json: { id: 99, idade: 50 } }] },
      })
    ).json<TestRunResponse>();
    const detail = await waitFinished(editor, executionId);
    const nodes = Object.fromEntries(detail.nodes.map((n) => [n.nodeName, n]));
    expect(nodes.Busca).toMatchObject({ pinned: true, itemsOut: 1 });
    expect(nodes['Saudação']?.output?.main?.[0]?.json.msg).toBe('Olá, cliente 99');
  });

  it('FR-020: reuse reaproveita a saída gravada dos nós anteriores; só o destino executa', async () => {
    const first = await waitFinished(
      editor,
      (await testRun(editor, { definition, destinationNodeId: 'se' })).json<TestRunResponse>()
        .executionId,
    );
    // Busca mudou na definição, mas é reaproveitada: a saída vem da execução anterior.
    const changed: WorkflowDefinition = {
      ...definition,
      nodes: definition.nodes.map((n) =>
        n.id === 'busca'
          ? { ...n, params: { fields: [{ name: 'id', type: 'number', value: '0' }] } }
          : n,
      ),
    };
    const res = await testRun(editor, {
      definition: changed,
      destinationNodeId: 'saida',
      reuse: { m: first.id, busca: first.id, se: first.id },
    });
    expect(res.statusCode).toBe(202);
    const detail = await waitFinished(editor, res.json<TestRunResponse>().executionId);
    const nodes = Object.fromEntries(detail.nodes.map((n) => [n.nodeName, n]));
    expect(nodes['Início']).toMatchObject({ pinned: true, reused: false });
    expect(nodes.Busca).toMatchObject({ reused: true, itemsIn: 3, itemsOut: 3 });
    expect(nodes['Adulto?']).toMatchObject({ reused: true });
    expect(nodes['Adulto?']?.output?.true?.map((i) => i.json.id)).toEqual([2, 3]);
    expect(nodes['Saudação']).toMatchObject({ reused: false });
    expect(nodes['Saudação']?.output?.main?.map((i) => i.json.msg)).toEqual([
      'Olá, cliente 2',
      'Olá, cliente 3',
    ]);
  });

  it('FR-020: reuse ignora execuções de outro workflow', async () => {
    const other = (
      await editor.call('POST', `/projects/${workflow.projectId}/workflows`, { name: 'Outro' })
    ).json<WorkflowDetail>();
    const foreign = (
      await editor.call('POST', `/workflows/${other.id}/test-run`, { definition })
    ).json<TestRunResponse>();
    await waitFinished(editor, foreign.executionId);
    const detail = await waitFinished(
      editor,
      (
        await testRun(editor, {
          definition,
          destinationNodeId: 'se',
          reuse: { busca: foreign.executionId },
        })
      ).json<TestRunResponse>().executionId,
    );
    expect(detail.nodes.find((n) => n.nodeId === 'busca')).toMatchObject({
      status: 'success',
      reused: false,
    });
  });

  it('spec 004 — FR-017: tentativas do retry ficam em node_executions.attempts', async () => {
    const retrying: WorkflowDefinition = {
      nodes: [
        manual,
        {
          id: 'h',
          type: 'http.request',
          name: 'Bloqueada',
          params: { url: 'http://10.0.0.1/' },
          settings: { retry: { maxTries: 3, waitMs: 1 } },
          position: [200, 0],
        },
      ],
      edges: [e('m', 'h')],
      settings: {},
    };
    const detail = await waitFinished(
      editor,
      (await testRun(editor, { definition: retrying })).json<TestRunResponse>().executionId,
    );
    expect(detail.status).toBe('error');
    const row = await ctx.database.db
      .selectFrom('node_executions')
      .select(['attempts', 'status'])
      .where('execution_id', '=', detail.id)
      .where('node_id', '=', 'h')
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ attempts: 3, status: 'error' });
  });

  it('FR-020: reuse com id de execução inválido responde 400', async () => {
    const res = await testRun(editor, { definition, reuse: { busca: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('FR-007/FR-014: erro de expressão fica registrado na execução e no nó', async () => {
    const broken = {
      ...definition,
      nodes: definition.nodes.map((n) =>
        n.id === 'busca'
          ? { ...n, params: { fields: [{ name: 'x', type: 'string', value: '={{ $json.a.b }}' }] } }
          : n,
      ),
    };
    const { executionId } = (await testRun(editor, { definition: broken })).json<TestRunResponse>();
    const detail = await waitFinished(editor, executionId);
    expect(detail.status).toBe('error');
    expect(detail.error).toMatchObject({ nodeId: 'busca' });
    expect(detail.error?.message).toContain('parâmetro "fields[0].value" do nó "Busca"');
    const node = detail.nodes.find((n) => n.nodeId === 'busca');
    expect(node).toMatchObject({ status: 'error', error: { name: 'ExpressionError' } });
    expect(node?.error?.message).toContain('Trecho: {{ $json.a.b }}');
  });

  it('FR-005: $env expõe só OLLY_EXPOSED_*', async () => {
    const withEnv = {
      ...definition,
      nodes: definition.nodes.map((n) =>
        n.id === 'busca'
          ? { ...n, params: { fields: [{ name: 'env', type: 'json', value: '={{ $env }}' }] } }
          : n,
      ),
    };
    const { executionId } = (
      await testRun(editor, { definition: withEnv, destinationNodeId: 'busca' })
    ).json<TestRunResponse>();
    const detail = await waitFinished(editor, executionId);
    const env = detail.nodes.find((n) => n.nodeId === 'busca')?.output?.main?.[0]?.json.env;
    expect(env).toEqual({ SAUDACAO: 'oi' });
  });

  it('SC-003: laço infinito numa expressão expira e a API segue respondendo', async () => {
    const looping = {
      ...definition,
      nodes: definition.nodes.map((n) =>
        n.id === 'busca'
          ? {
              ...n,
              params: {
                fields: [
                  { name: 'x', type: 'string', value: '={{ (() => { while (true) {} })() }}' },
                ],
              },
            }
          : n,
      ),
    };
    const { executionId } = (
      await testRun(editor, { definition: looping })
    ).json<TestRunResponse>();
    const started = Date.now();
    const health = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(1000);
    const detail = await waitFinished(editor, executionId);
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toMatch(/Tempo limite da expressão excedido/);
  });

  it('FR-011: estrutura inválida responde 422 sem criar execução', async () => {
    const cyclic = { ...definition, edges: [...definition.edges, e('saida', 'busca')] };
    const res = await testRun(editor, { definition: cyclic });
    expect(res.statusCode).toBe(422);
  });

  it('FR-011/FR-013: permissões — executor executa, visualizador lê, de fora não vê', async () => {
    expect((await testRun(viewer, { definition })).statusCode).toBe(403);
    expect((await testRun(outsider, { definition })).statusCode).toBe(404);
    const { executionId } = (await testRun(executor, { definition })).json<TestRunResponse>();
    await waitFinished(executor, executionId);
    expect((await viewer.call('GET', `/executions/${executionId}`)).statusCode).toBe(200);
    expect((await outsider.call('GET', `/executions/${executionId}`)).statusCode).toBe(404);
  });
});

describe('spec 003 — FR-015: truncamento no log', () => {
  let small: TestContext;
  afterAll(async () => {
    await small.close();
  });

  it('FR-015: dados acima do limite são cortados e marcados; contagens ficam completas', async () => {
    small = await startTestContext({
      execution: {
        // Folgado: com testes em paralelo, CPU disputada não pode virar timeout de expressão.
        expressionTimeoutMs: 1000,
        isolateMemoryMb: 64,
        nodeDataMaxBytes: 4096,
        timezone: 'UTC',
        workflowTimeoutMs: 300_000,
        defaultMaxParallel: 8,
        maxLoopIterations: 10_000,
      },
    });
    const admin = await loginAs(small, { sub: 'a', email: 'a@t.local', groups: ['admin'] });
    const project = (await admin.call('POST', '/projects', { name: 'P' })).json<ProjectSummary>();
    const wf = (
      await admin.call('POST', `/projects/${project.id}/workflows`, { name: 'Grande' })
    ).json<WorkflowDetail>();
    const items = Array.from({ length: 200 }, (_, i) => ({ json: { i, texto: 'x'.repeat(50) } }));
    const res = await admin.call('POST', `/workflows/${wf.id}/test-run`, {
      definition: { nodes: [manual], edges: [], settings: {}, pinData: { m: items } },
    });
    const { executionId } = res.json<TestRunResponse>();
    let detail: ExecutionDetail | undefined;
    for (let i = 0; i < 100 && detail?.status !== 'success'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      detail = (await admin.call('GET', `/executions/${executionId}`)).json<ExecutionDetail>();
    }
    const node = detail?.nodes[0];
    expect(node).toMatchObject({ dataTruncated: true, itemsOut: 200 });
    expect(node?.output?.main?.length).toBeGreaterThan(0);
    expect(node?.output?.main?.length).toBeLessThan(200);

    // FR-020: nó com dados truncados não é reaproveitado (executa de novo).
    const copia = {
      ...busca,
      id: 'copia',
      name: 'Cópia',
      params: { fields: [], includeOtherFields: true },
    };
    const big = {
      nodes: [manual, copia],
      edges: [e('m', 'copia')],
      settings: {},
      pinData: { m: items },
    };
    const waitSmall = async (id: string) => {
      for (let i = 0; i < 100; i++) {
        const d = (await admin.call('GET', `/executions/${id}`)).json<ExecutionDetail>();
        if (!['queued', 'running'].includes(d.status)) return d;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('execução não terminou');
    };
    const run1 = await waitSmall(
      (
        await admin.call('POST', `/workflows/${wf.id}/test-run`, { definition: big })
      ).json<TestRunResponse>().executionId,
    );
    expect(run1.nodes.find((n) => n.nodeId === 'copia')).toMatchObject({ dataTruncated: true });
    const run2 = await waitSmall(
      (
        await admin.call('POST', `/workflows/${wf.id}/test-run`, {
          definition: {
            ...big,
            nodes: [manual, copia, { ...copia, id: 'fim', name: 'Fim' }],
            edges: [e('m', 'copia'), e('copia', 'fim')],
          },
          destinationNodeId: 'fim',
          reuse: { copia: run1.id },
        })
      ).json<TestRunResponse>().executionId,
    );
    expect(run2.nodes.find((n) => n.nodeId === 'copia')).toMatchObject({
      reused: false,
      itemsOut: 200,
    });
  });
});
