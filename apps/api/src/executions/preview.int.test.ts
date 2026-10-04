import type {
  ExecutionDetail,
  ExpressionPreviewResponse,
  ProjectSummary,
  TestRunResponse,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let editor: TestUser, viewer: TestUser, outsider: TestUser;
let workflow: WorkflowDetail;
let executionId: string;

const definition: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'busca',
      type: 'data.set',
      name: 'Busca',
      params: {
        fields: [{ name: 'id', type: 'number', value: '={{ $itemIndex + 10 }}' }],
        includeOtherFields: true,
      },
      position: [200, 0],
    },
    { id: 'depois', type: 'data.set', name: 'Depois', params: { fields: [] }, position: [400, 0] },
  ],
  edges: [
    { id: 'a', from: 'm', fromPort: 'main', to: 'busca', toPort: 'main' },
    { id: 'b', from: 'busca', fromPort: 'main', to: 'depois', toPort: 'main' },
  ],
  settings: {},
  pinData: { m: [{ json: { nome: 'Ana' } }, { json: { nome: 'Bruno' } }] },
};

const preview = (user: TestUser, body: object) =>
  user.call('POST', `/workflows/${workflow.id}/expressions/preview`, { definition, ...body });

beforeAll(async () => {
  ctx = await startTestContext();
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@t.local' });
  outsider = await loginAs(ctx, { sub: 'outsider', email: 'outsider@t.local' });
  const project = (await admin.call('POST', '/projects', { name: 'P' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  await admin.call('PUT', `/projects/${project.id}/members/${viewer.id}`, { role: 'viewer' });
  workflow = (
    await editor.call('POST', `/projects/${project.id}/workflows`, { name: 'Preview' })
  ).json<WorkflowDetail>();
  // Executa só até "Busca": o preview em "Depois" usa a saída do pai.
  ({ executionId } = (
    await editor.call('POST', `/workflows/${workflow.id}/test-run`, {
      definition,
      destinationNodeId: 'busca',
    })
  ).json<TestRunResponse>());
  for (let i = 0; i < 100; i++) {
    const d = (await editor.call('GET', `/executions/${executionId}`)).json<ExecutionDetail>();
    if (d.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 50));
  }
});
afterAll(async () => {
  await ctx.close();
});

describe('spec 003 — FR-018: pré-visualização de expressões', () => {
  it('FR-018: avalia sobre a entrada do nó na última execução', async () => {
    const res = await preview(editor, {
      nodeId: 'busca',
      expression: '=Olá {{ $json.nome }}',
      executionId,
    });
    expect(res.json<ExpressionPreviewResponse>()).toEqual({ ok: true, value: 'Olá Ana' });
    const second = await preview(editor, {
      nodeId: 'busca',
      expression: '={{ $json.nome }}',
      executionId,
      itemIndex: 1,
    });
    expect(second.json<ExpressionPreviewResponse>()).toEqual({ ok: true, value: 'Bruno' });
  });

  it('FR-018: nó que não rodou usa a saída dos pais, com paired items', async () => {
    const res = await preview(editor, {
      nodeId: 'depois',
      expression:
        "={{ $json.id }}-{{ $('Busca').item.json.nome }}-{{ $('Início').item.json.nome }}",
      executionId,
      itemIndex: 1,
    });
    expect(res.json<ExpressionPreviewResponse>()).toEqual({ ok: true, value: '11-Bruno-Bruno' });
  });

  it('FR-018: sem execução, $json é vazio', async () => {
    const res = await preview(editor, {
      nodeId: 'busca',
      expression: '={{ Object.keys($json).length }}',
    });
    expect(res.json<ExpressionPreviewResponse>()).toEqual({ ok: true, value: 0 });
  });

  it('FR-018/FR-007: erro de sintaxe volta como resultado, não como falha HTTP', async () => {
    const res = await preview(editor, {
      nodeId: 'busca',
      expression: '={{ $json.nome.( }}',
      executionId,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ExpressionPreviewResponse>()).toMatchObject({
      ok: false,
      error: { kind: 'syntax' },
    });
  });

  it('FR-018: permissões e execução de outro workflow', async () => {
    expect((await preview(viewer, { nodeId: 'busca', expression: '={{ 1 }}' })).statusCode).toBe(
      403,
    );
    expect((await preview(outsider, { nodeId: 'busca', expression: '={{ 1 }}' })).statusCode).toBe(
      404,
    );
    const other = (
      await editor.call('POST', `/projects/${workflow.projectId}/workflows`, { name: 'Outro' })
    ).json<WorkflowDetail>();
    const res = await editor.call('POST', `/workflows/${other.id}/expressions/preview`, {
      definition,
      nodeId: 'busca',
      expression: '={{ 1 }}',
      executionId,
    });
    expect(res.statusCode).toBe(404);
  });
});
