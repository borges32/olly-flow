import { HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type {
  ExecutionDetail,
  ExecutionList,
  ProjectSummary,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflow, edge, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { startTestMinio, type TestMinio } from '../testing/minio.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let minio: TestMinio;
let ctx: TestContext;
let admin: TestUser, editor: TestUser;
let project: ProjectSummary;
let counter = 0;

/** Webhook → Set: `fail: true` no corpo faz o Set falhar (expressão inválida). */
const hookFlow = (
  path: string,
  settings: WorkflowDefinition['settings'] = {},
): WorkflowDefinition => ({
  nodes: [
    {
      id: 'w',
      type: 'trigger.webhook',
      name: 'Webhook',
      params: { httpMethod: 'POST', path, responseMode: 'lastNode' },
      position: [0, 0],
    },
    {
      id: 's',
      type: 'data.set',
      name: 'Montar',
      params: {
        fields: [
          {
            name: 'texto',
            type: 'string',
            value:
              "={{ $json.body.fail ? $json.body.nada.campo : 'x'.repeat($json.body.tamanho ?? 10) }}",
          },
        ],
      },
      position: [200, 0],
    },
  ],
  edges: [edge('w', 's')],
  settings,
});

async function publish(definition: WorkflowDefinition): Promise<WorkflowDetail> {
  const wf = await createWorkflow(editor, project.id, definition);
  const res = await editor.call('POST', `/workflows/${wf.id}/publish`, { message: 'Política' });
  expect(res.statusCode).toBe(200);
  return wf;
}

/** Chama o webhook e devolve o detalhe da execução de produção terminada. */
async function runProduction(
  wf: WorkflowDetail,
  path: string,
  body: object,
): Promise<ExecutionDetail> {
  const before = new Date(Date.now() - 1000).toISOString();
  await ctx.app.inject({
    method: 'POST',
    url: `/webhook/${path}`,
    payload: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  for (let i = 0; i < 200; i++) {
    const list = (
      await editor.call(
        'GET',
        `/executions?workflowId=${wf.id}&mode=production&from=${encodeURIComponent(before)}`,
      )
    ).json<ExecutionList>();
    const done = list.items.find((e) => !['queued', 'running'].includes(e.status));
    if (done) {
      // O descarte da política "só erros" acontece logo depois do fim.
      await new Promise((r) => setTimeout(r, 200));
      return (await editor.call('GET', `/executions/${done.id}`)).json<ExecutionDetail>();
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('execução de produção não terminou');
}

const nodeRows = (executionId: string) =>
  ctx.database.db
    .selectFrom('node_executions')
    .select([
      'node_id',
      'input_data',
      'output_data',
      'input_sources',
      'data_ref',
      'items_out',
      'status',
    ])
    .where('execution_id', '=', executionId)
    .execute();

beforeAll(async () => {
  minio = await startTestMinio();
  ctx = await startTestContext({
    s3: minio.config,
    // FR-013: limite baixo para o teste (padrão 256 KB).
    governance: {
      userInactiveDays: 90,
      inlineDataLimit: 4096,
      maskingSalt: 'salt-de-teste-0123456789',
      retention: { dataDays: 30, metadataDays: 365 },
      maintenanceCron: '0 3 * * *',
    },
  });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'Políticas' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
}, 240_000);
afterAll(async () => {
  await ctx.close();
  await minio.stop();
});

const nextPath = () => `politica-${++counter}`;

describe('spec 009 — FR-012/SC-004: política de dados das execuções', () => {
  it('FR-012/SC-004: "só erros" não guarda os dados das execuções com sucesso, mas guarda os das com erro', async () => {
    const path = nextPath();
    const wf = await publish(hookFlow(path, { saveExecutionData: 'errorsOnly' }));
    const ok = await runProduction(wf, path, { tamanho: 5 });
    expect(ok.status).toBe('success');
    expect(ok.nodes.map((n) => [n.nodeId, n.status, n.itemsOut])).toEqual([
      ['w', 'success', 1],
      ['s', 'success', 1],
    ]);
    for (const row of await nodeRows(ok.id)) {
      expect(row).toMatchObject({
        input_data: null,
        output_data: null,
        input_sources: null,
        data_ref: null,
      });
    }
    const failed = await runProduction(wf, path, { fail: true });
    expect(failed.status).toBe('error');
    const rows = await nodeRows(failed.id);
    expect(rows.find((r) => r.node_id === 'w')?.output_data).not.toBeNull();
  });

  it('FR-012: "nada" (padrão do projeto) grava só os metadados; execuções de teste continuam guardando', async () => {
    await admin.call('PUT', `/projects/${project.id}/settings`, { saveExecutionData: 'none' });
    const path = nextPath();
    const wf = await publish(hookFlow(path));
    const run = await runProduction(wf, path, { tamanho: 3 });
    expect(run.status).toBe('success');
    expect(run.nodes.every((n) => n.output === null && n.input === null)).toBe(true);
    expect(run.nodes.map((n) => n.itemsOut)).toEqual([1, 1]);

    const test = await waitForStatus(
      editor,
      await startTestRun(editor, wf, {
        ...wf.definition,
        pinData: { w: [{ json: { body: { tamanho: 2 } } }] },
      }),
    );
    expect(test.nodes.find((n) => n.nodeId === 's')?.output?.main?.[0]?.json).toEqual({
      texto: 'xx',
    });

    // O workflow pode guardar tudo mesmo com o padrão do projeto "nada".
    const pathAll = nextPath();
    const wfAll = await publish(hookFlow(pathAll, { saveExecutionData: 'all' }));
    const all = await runProduction(wfAll, pathAll, { tamanho: 4 });
    expect(all.nodes.find((n) => n.nodeId === 's')?.output?.main?.[0]?.json).toEqual({
      texto: 'xxxx',
    });
    await admin.call('PUT', `/projects/${project.id}/settings`, { saveExecutionData: 'all' });
  });
});

describe('spec 009 — FR-013: dados grandes no object storage, com leitura transparente', () => {
  it('FR-013: acima do limite, os dados vão para o storage; a API lê de forma transparente', async () => {
    const path = nextPath();
    const wf = await publish(hookFlow(path));
    const run = await runProduction(wf, path, { tamanho: 10_000 });
    expect(run.status).toBe('success');
    const rows = await nodeRows(run.id);
    const big = rows.find((r) => r.node_id === 's');
    expect(big?.data_ref).toBe(`executions/${run.id}/data/s-0.json`);
    expect(big?.output_data).toBeNull();
    expect(big?.input_data).toBeNull();
    // Pequeno fica no banco.
    expect(rows.find((r) => r.node_id === 'w')?.data_ref).toBeNull();
    await minio.s3.send(new HeadObjectCommand({ Bucket: 'olly', Key: big?.data_ref ?? '' }));

    const texto = run.nodes.find((n) => n.nodeId === 's')?.output?.main?.[0]?.json.texto;
    expect(texto).toHaveLength(10_000);
    expect(run.nodes.find((n) => n.nodeId === 's')?.input?.main?.[0]?.json).toMatchObject({
      body: { tamanho: 10_000 },
    });
  });

  it('FR-012/FR-013: "só erros" com sucesso também remove os objetos do storage', async () => {
    const path = nextPath();
    const wf = await publish(hookFlow(path, { saveExecutionData: 'errorsOnly' }));
    const run = await runProduction(wf, path, { tamanho: 10_000 });
    expect(run.status).toBe('success');
    const objects = await minio.s3.send(
      new ListObjectsV2Command({ Bucket: 'olly', Prefix: `executions/${run.id}/` }),
    );
    expect(objects.KeyCount ?? 0).toBe(0);
  });
});
