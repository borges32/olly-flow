import type {
  ExecutionDetail,
  ProjectSummary,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let admin: TestUser, editor: TestUser;
let project: ProjectSummary;
let other: ProjectSummary;

beforeAll(async () => {
  ctx = await startTestContext({});
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@sub.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@sub.local' });
  project = (await admin.call('POST', '/projects', { name: 'Sub' })).json<ProjectSummary>();
  other = (await admin.call('POST', '/projects', { name: 'Outro sub' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
});
afterAll(async () => {
  await ctx.close();
});

/** Filho: recebe itens e devolve `dobro`; opcionalmente valida o schema. */
const child = (schema = ''): WorkflowDefinition => ({
  nodes: [
    {
      id: 't',
      type: 'trigger.executeWorkflow',
      name: 'Chamado',
      params: { inputSchema: schema },
      position: [0, 0],
    },
    {
      id: 's',
      type: 'data.set',
      name: 'Dobro',
      params: {
        fields: [{ name: 'dobro', type: 'number', value: '={{ $json.n * 2 }}' }],
        includeOtherFields: true,
      },
      position: [200, 0],
    },
  ],
  edges: [{ id: 'e', from: 't', fromPort: 'main', to: 's', toPort: 'main' }],
  settings: {},
});

const parent = (workflowId: string, params: Record<string, unknown> = {}): WorkflowDefinition => ({
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'x',
      type: 'flow.executeWorkflow',
      name: 'Chama',
      params: { workflowId, mode: 'perItem', ...params },
      position: [200, 0],
    },
  ],
  edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'x', toPort: 'main' }],
  settings: {},
  pinData: { m: [{ json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 3 } }] },
});

async function published(user: TestUser, projectId: string, definition: WorkflowDefinition) {
  const wf = await createWorkflow(user, projectId, definition);
  const res = await user.call('POST', `/workflows/${wf.id}/publish`, { message: 'Sub-workflow' });
  if (res.statusCode !== 200) throw new Error(`publicação: ${res.statusCode} ${res.body}`);
  return wf;
}

const outputOf = (detail: ExecutionDetail, nodeId: string) =>
  detail.nodes.find((n) => n.nodeId === nodeId)?.output?.main?.map((i) => i.json);

describe('spec 008 — FR-009/FR-010/SC-006: sub-workflows', () => {
  it('FR-009/SC-006: por item, preserva a ordem e vincula as execuções filhas ao pai', async () => {
    const sub = await published(editor, project.id, child());
    const wf = await createWorkflow(editor, project.id, parent(sub.id));
    const executionId = await startTestRun(editor, wf);
    const detail = await waitForStatus(editor, executionId);
    expect(detail.status).toBe('success');
    expect(outputOf(detail, 'x')).toEqual([
      { n: 1, dobro: 2 },
      { n: 2, dobro: 4 },
      { n: 3, dobro: 6 },
    ]);
    const children = await ctx.database.db
      .selectFrom('executions')
      .select([
        'workflow_id',
        'parent_execution_id',
        'depth',
        'trigger_type',
        'triggered_by',
        'status',
      ])
      .where('parent_execution_id', '=', executionId)
      .execute();
    expect(children).toHaveLength(3);
    expect(children.every((c) => c.workflow_id === sub.id && c.depth === 1)).toBe(true);
    expect(children.every((c) => c.trigger_type === 'subworkflow' && c.status === 'success')).toBe(
      true,
    );
    expect(children[0]?.triggered_by).toBe(editor.id);
  });

  it('FR-009: uma vez, com todos os itens', async () => {
    const sub = await published(editor, project.id, child());
    const wf = await createWorkflow(editor, project.id, parent(sub.id, { mode: 'once' }));
    const detail = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(outputOf(detail, 'x')).toHaveLength(3);
  });

  it('FR-010/SC-006: recursão é bloqueada', async () => {
    // A chama B, B chama A.
    const a = await createWorkflow(editor, project.id, child());
    const b = await published(editor, project.id, {
      ...child(),
      nodes: [
        ...child().nodes.slice(0, 1),
        {
          id: 'x',
          type: 'flow.executeWorkflow',
          name: 'Chama A',
          params: { workflowId: a.id, mode: 'once' },
          position: [200, 0],
        },
      ],
      edges: [{ id: 'e', from: 't', fromPort: 'main', to: 'x', toPort: 'main' }],
    });
    const aDefinition: WorkflowDefinition = {
      ...child(),
      nodes: [
        ...child().nodes.slice(0, 1),
        {
          id: 'x',
          type: 'flow.executeWorkflow',
          name: 'Chama B',
          params: { workflowId: b.id, mode: 'once' },
          position: [200, 0],
        },
      ],
      edges: [{ id: 'e', from: 't', fromPort: 'main', to: 'x', toPort: 'main' }],
    };
    const saved = (
      await editor.call('PUT', `/workflows/${a.id}`, { definition: aDefinition, baseVersion: 1 })
    ).json<WorkflowDetail>();
    await editor.call('POST', `/workflows/${a.id}/publish`, { message: 'A' });
    const starter = await createWorkflow(editor, project.id, parent(a.id, { mode: 'once' }));
    const detail = await waitForStatus(editor, await startTestRun(editor, starter));
    expect(saved.version).toBe(2);
    expect(detail.status).toBe('error');
    expect(JSON.stringify(detail)).toContain('Recursão detectada');
  });

  it('FR-010: o limite de profundidade é aplicado', async () => {
    // Cadeia W4 → W3 → W2 → W1 → W0 com limite configurado de 5: o 6º nível falha.
    let target = await published(editor, project.id, child());
    for (let i = 0; i < 5; i++) {
      target = await published(editor, project.id, {
        ...child(),
        nodes: [
          ...child().nodes.slice(0, 1),
          {
            id: 'x',
            type: 'flow.executeWorkflow',
            name: `Nível ${String(i)}`,
            params: { workflowId: target.id, mode: 'once' },
            position: [200, 0],
          },
        ],
        edges: [{ id: 'e', from: 't', fromPort: 'main', to: 'x', toPort: 'main' }],
      });
    }
    const starter = await createWorkflow(editor, project.id, parent(target.id, { mode: 'once' }));
    const detail = await waitForStatus(editor, await startTestRun(editor, starter));
    expect(detail.status).toBe('error');
    expect(JSON.stringify(detail)).toContain('Limite de 5 níveis de sub-workflow excedido');
  });

  it('FR-009: alvo não publicado, sem o gatilho ou de projeto sem permissão é recusado', async () => {
    const draft = await createWorkflow(editor, project.id, child());
    const notPublished = await waitForStatus(
      editor,
      await startTestRun(editor, await createWorkflow(editor, project.id, parent(draft.id))),
    );
    expect(notPublished.error?.message ?? JSON.stringify(notPublished)).toContain(
      'não está publicado',
    );

    const foreign = await published(admin, other.id, child());
    const denied = await waitForStatus(
      editor,
      await startTestRun(editor, await createWorkflow(editor, project.id, parent(foreign.id))),
    );
    expect(JSON.stringify(denied)).toContain('Sem permissão para executar o workflow');
  });

  it('FR-011: itens fora do schema do filho falham com erro claro', async () => {
    const sub = await published(
      editor,
      project.id,
      child(JSON.stringify({ type: 'object', required: ['email'] })),
    );
    const detail = await waitForStatus(
      editor,
      await startTestRun(editor, await createWorkflow(editor, project.id, parent(sub.id))),
    );
    expect(detail.status).toBe('error');
    expect(JSON.stringify(detail)).toContain('Itens recebidos fora do schema do sub-workflow');
  });

  it('FR-009: sem aguardar, a filha vai para a fila e o pai segue', async () => {
    const sub = await published(editor, project.id, child());
    const wf = await createWorkflow(
      editor,
      project.id,
      parent(sub.id, { mode: 'once', waitForCompletion: false }),
    );
    const executionId = await startTestRun(editor, wf);
    const detail = await waitForStatus(editor, executionId);
    expect(outputOf(detail, 'x')).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    await expect
      .poll(async () => {
        const row = await ctx.database.db
          .selectFrom('executions')
          .select('status')
          .where('parent_execution_id', '=', executionId)
          .executeTakeFirst();
        return row?.status;
      })
      .toBe('success');
  });
});
