import { ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import type {
  ExecutionDetail,
  ProjectSummary,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkflow,
  manualNode,
  startTestRun,
  waitForStatus,
} from '../testing/execution-helpers.js';
import { startTestMinio, type TestMinio } from '../testing/minio.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let minio: TestMinio;
let ctx: TestContext;
let admin: TestUser, editor: TestUser, executor: TestUser, viewer: TestUser;
let project: ProjectSummary;
let wf: WorkflowDetail;

beforeAll(async () => {
  minio = await startTestMinio();
  ctx = await startTestContext({ s3: minio.config });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@del.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@del.local' });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@del.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@del.local' });
  project = (await admin.call('POST', '/projects', { name: 'Excluir' })).json<ProjectSummary>();
  for (const [user, role] of [
    [editor, 'editor'],
    [executor, 'executor'],
    [viewer, 'viewer'],
  ] as const) {
    await admin.call('PUT', `/projects/${project.id}/members/${user.id}`, { role });
  }
  wf = await createWorkflow(admin, project.id, { nodes: [manualNode()], edges: [], settings: {} });
}, 240_000);
afterAll(async () => {
  await ctx.close();
  await minio.stop();
});

const db = () => ctx.database.db;

/** Execução terminada com dados em todas as tabelas da execução e um objeto no storage. */
async function executionWithData(status = 'success'): Promise<string> {
  const now = new Date();
  const { id } = await db()
    .insertInto('executions')
    .values({
      workflow_id: wf.id,
      project_id: project.id,
      mode: 'production',
      trigger_type: 'webhook',
      status,
      started_at: now,
      finished_at: status === 'running' ? null : now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db()
    .insertInto('node_executions')
    .values({
      execution_id: id,
      node_id: 'm',
      node_name: 'm',
      status: 'success',
      started_at: now,
      finished_at: now,
      items_in: 1,
      items_out: 1,
      output_data: JSON.stringify({ main: [{ json: { pessoal: 'dado' } }] }),
    })
    .execute();
  await db()
    .insertInto('execution_payloads')
    .values({ execution_id: id, data: JSON.stringify({ triggerItems: [] }) })
    .execute();
  await db()
    .insertInto('execution_state')
    .values({ execution_id: id, state: JSON.stringify({}) })
    .execute();
  await db()
    .insertInto('mcp_calls')
    .values({
      execution_id: id,
      project_id: project.id,
      node_id: 'mcp',
      server_name: 'Teste',
      operation: 'callTool',
      target: 'soma',
      status: 'success',
    })
    .execute();
  await db()
    .insertInto('agent_steps')
    .values({
      execution_id: id,
      project_id: project.id,
      node_id: 'agent',
      step_index: 0,
      kind: 'final',
      content: JSON.stringify({ resposta: 'dado' }),
    })
    .execute();
  await db()
    .insertInto('llm_usage')
    .values({
      execution_id: id,
      project_id: project.id,
      workflow_id: wf.id,
      node_id: 'agent',
      provider: 'fake',
      model: 'fake',
      input_tokens: 10,
      output_tokens: 5,
    })
    .execute();
  await minio.s3.send(
    new PutObjectCommand({ Bucket: 'olly', Key: `executions/${id}/binario`, Body: 'conteúdo' }),
  );
  return id;
}

const count = async (
  table:
    | 'node_executions'
    | 'execution_payloads'
    | 'execution_state'
    | 'mcp_calls'
    | 'agent_steps'
    | 'llm_usage',
  id: string,
) =>
  Number(
    (
      await db()
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('execution_id', '=', id)
        .executeTakeFirstOrThrow()
    ).n,
  );
const objects = async (id: string) =>
  (await minio.s3.send(new ListObjectsV2Command({ Bucket: 'olly', Prefix: `executions/${id}/` })))
    .KeyCount ?? 0;

describe('spec 026 — excluir execução', () => {
  it('FR-005/SC-002/NFR-002: remove a execução com todos os dados e objetos, preserva o uso de LLM e audita', async () => {
    const id = await executionWithData();
    expect(await count('node_executions', id)).toBe(1);
    expect(await objects(id)).toBe(1);

    const res = await editor.call('DELETE', `/executions/${id}`);
    expect(res.statusCode).toBe(204);

    expect((await editor.call('GET', `/executions/${id}`)).statusCode).toBe(404);
    for (const table of [
      'node_executions',
      'execution_payloads',
      'execution_state',
      'mcp_calls',
      'agent_steps',
    ] as const) {
      expect(await count(table, id), table).toBe(0);
    }
    expect(await objects(id)).toBe(0);
    // Contabilidade e cota de IA (spec 011) ficam.
    expect(await count('llm_usage', id)).toBe(1);

    const audit = await db()
      .selectFrom('audit_log')
      .select(['action', 'user_id', 'details'])
      .where('entity_id', '=', id)
      .execute();
    expect(audit).toEqual([
      {
        action: 'execution.delete',
        user_id: editor.id,
        details: { workflowId: wf.id, status: 'success' },
      },
    ]);
    // Já excluída: não encontrada.
    expect((await editor.call('DELETE', `/executions/${id}`)).statusCode).toBe(404);
  });

  it('FR-005: execução ativa não é excluída (409); executor e viewer não têm permissão (403)', async () => {
    const running = await executionWithData('running');
    const res = await editor.call('DELETE', `/executions/${running}`);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('pare-a antes de excluir');
    expect(await count('node_executions', running)).toBe(1);

    const done = await executionWithData();
    expect((await executor.call('DELETE', `/executions/${done}`)).statusCode).toBe(403);
    expect((await viewer.call('DELETE', `/executions/${done}`)).statusCode).toBe(403);
    expect(await count('node_executions', done)).toBe(1);
    expect((await admin.call('DELETE', `/executions/${done}`)).statusCode).toBe(204);
  });

  it('FR-004: o detalhe traz as subexecuções com o nó que as criou', async () => {
    const child: WorkflowDefinition = {
      nodes: [
        {
          id: 't',
          type: 'trigger.executeWorkflow',
          name: 'Chamado',
          params: {},
          position: [0, 0],
        },
      ],
      edges: [],
      settings: {},
    };
    const sub = await createWorkflow(editor, project.id, child, 'Filho');
    expect(
      (await editor.call('POST', `/workflows/${sub.id}/publish`, { message: 'Sub' })).statusCode,
    ).toBe(200);
    const parent = await createWorkflow(editor, project.id, {
      nodes: [
        manualNode(),
        {
          id: 'x',
          type: 'flow.executeWorkflow',
          name: 'Chama',
          params: { workflowId: sub.id, mode: 'perItem' },
          position: [200, 0],
        },
      ],
      edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'x', toPort: 'main' }],
      settings: {},
      pinData: { m: [{ json: { n: 1 } }, { json: { n: 2 } }] },
    });
    const detail: ExecutionDetail = await waitForStatus(editor, await startTestRun(editor, parent));
    expect(detail.status).toBe('success');
    expect(detail.subExecutions).toHaveLength(2);
    expect(detail.subExecutions.map((s) => [s.nodeId, s.workflowId, s.workflowName])).toEqual([
      ['x', sub.id, 'Filho'],
      ['x', sub.id, 'Filho'],
    ]);
    expect(detail.subExecutions.every((s) => s.status === 'success')).toBe(true);
  });
});
