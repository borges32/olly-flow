import type { NodeDescription } from '@olly/nodes';
import type {
  ApiErrorBody,
  Paginated,
  ProjectSummary,
  WorkflowDetail,
  WorkflowSummary,
  WorkflowVersionSummary,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let editor: TestUser;
let projectId: string;

const node = (id: string, type: string, name: string, params: Record<string, unknown> = {}) => ({
  id,
  type,
  name,
  params,
  position: [100, 50],
});
const edge = (from: string, to: string) => ({
  id: `${from}-${to}`,
  from,
  fromPort: 'main',
  to,
  toPort: 'main',
});
const manualSet = {
  nodes: [
    node('m', 'trigger.manual', 'Início'),
    node('s', 'data.set', 'Definir', {
      fields: [{ name: 'cliente.nome', type: 'string', value: 'Ana' }],
    }),
  ],
  edges: [edge('m', 's')],
  settings: {},
};

beforeAll(async () => {
  ctx = await startTestContext();
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local', name: 'Eduardo' });
  projectId = (await admin.call('POST', '/projects', { name: 'P' })).json<ProjectSummary>().id;
  await admin.call('PUT', `/projects/${projectId}/members/${editor.id}`, { role: 'editor' });
});
afterAll(async () => {
  await ctx.close();
});

async function create(name: string, definition: unknown = manualSet): Promise<WorkflowDetail> {
  const res = await editor.call('POST', `/projects/${projectId}/workflows`, { name, definition });
  expect(res.statusCode).toBe(201);
  return res.json<WorkflowDetail>();
}

describe('spec 002 — FR-001/FR-002: CRUD e versionamento', () => {
  it('FR-001: cria workflow vazio e com definição', async () => {
    const empty = (
      await editor.call('POST', `/projects/${projectId}/workflows`, { name: 'Vazio' })
    ).json<WorkflowDetail>();
    expect(empty).toMatchObject({
      name: 'Vazio',
      version: 1,
      projectId,
      definition: { nodes: [], edges: [] },
    });
    const wf = await create('Com nós');
    expect(wf.definition).toEqual(manualSet);
    expect(wf.createdBy).toBe(editor.id);
  });

  it('FR-001/FR-002: abre a última versão e salva criando nova versão com a definição completa', async () => {
    const wf = await create('Versionado');
    const changed = {
      ...manualSet,
      nodes: manualSet.nodes.map((n) => ({ ...n, position: [300, 300] })),
    };
    const saved = (
      await editor.call('PUT', `/workflows/${wf.id}`, { definition: changed, baseVersion: 1 })
    ).json<WorkflowDetail>();
    expect(saved.version).toBe(2);
    expect(
      (await editor.call('GET', `/workflows/${wf.id}`)).json<WorkflowDetail>().definition,
    ).toEqual(changed);

    const versions = (await editor.call('GET', `/workflows/${wf.id}/versions`)).json<
      WorkflowVersionSummary[]
    >();
    expect(versions.map((v) => [v.version, v.createdByName])).toEqual([
      [2, 'Eduardo'],
      [1, 'Eduardo'],
    ]);
    const v1 = await ctx.database.db
      .selectFrom('workflow_versions')
      .select('definition')
      .where('workflow_id', '=', wf.id)
      .where('version', '=', 1)
      .executeTakeFirstOrThrow();
    expect(v1.definition).toEqual(manualSet);
  });

  it('FR-001: renomeia ao salvar', async () => {
    const wf = await create('Nome antigo');
    const saved = await editor.call('PUT', `/workflows/${wf.id}`, {
      name: 'Nome novo',
      definition: manualSet,
      baseVersion: 1,
    });
    expect(saved.json<WorkflowDetail>().name).toBe('Nome novo');
  });

  it('FR-001: lista paginada, ordenada pela última alteração, com busca', async () => {
    const res = await editor.call('GET', `/projects/${projectId}/workflows?page=1&pageSize=2`);
    const page = res.json<Paginated<WorkflowSummary>>();
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThanOrEqual(4);
    expect(page.items[0]?.name).toBe('Nome novo');
    const page2 = (
      await editor.call('GET', `/projects/${projectId}/workflows?page=2&pageSize=2`)
    ).json<Paginated<WorkflowSummary>>();
    expect(page2.items.map((i) => i.id)).not.toContain(page.items[0]?.id);
    const found = (
      await editor.call('GET', `/projects/${projectId}/workflows?search=versionado`)
    ).json<Paginated<WorkflowSummary>>();
    expect(found.items.map((i) => i.name)).toEqual(['Versionado']);
    expect(
      (await editor.call('GET', `/projects/${projectId}/workflows?pageSize=500`)).statusCode,
    ).toBe(400);
  });

  it('FR-001: exclusão é soft delete; o histórico de versões permanece', async () => {
    const wf = await create('Para excluir');
    expect((await editor.call('DELETE', `/workflows/${wf.id}`)).statusCode).toBe(204);
    expect((await editor.call('GET', `/workflows/${wf.id}`)).statusCode).toBe(404);
    const list = (await editor.call('GET', `/projects/${projectId}/workflows?search=excluir`)).json<
      Paginated<WorkflowSummary>
    >();
    expect(list.total).toBe(0);
    const row = await ctx.database.db
      .selectFrom('workflows')
      .select('deleted_at')
      .where('id', '=', wf.id)
      .executeTakeFirstOrThrow();
    expect(row.deleted_at).not.toBeNull();
    const versions = await ctx.database.db
      .selectFrom('workflow_versions')
      .select('version')
      .where('workflow_id', '=', wf.id)
      .execute();
    expect(versions).toHaveLength(1);
  });
});

describe('spec 002 — FR-003/SC-006: concorrência otimista', () => {
  it('FR-003/SC-006: salvar sobre versão desatualizada → 409, sem criar versão', async () => {
    const wf = await create('Concorrência');
    expect(
      (await editor.call('PUT', `/workflows/${wf.id}`, { definition: manualSet, baseVersion: 1 }))
        .statusCode,
    ).toBe(200);
    const stale = await editor.call('PUT', `/workflows/${wf.id}`, {
      definition: manualSet,
      baseVersion: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiErrorBody>()).toMatchObject({ error: { code: 'conflict' } });
    expect(
      (await editor.call('GET', `/workflows/${wf.id}/versions`)).json<unknown[]>(),
    ).toHaveLength(2);
  });

  it('FR-003: salvamentos simultâneos na mesma base: só um vence', async () => {
    const wf = await create('Corrida');
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        editor.call('PUT', `/workflows/${wf.id}`, { definition: manualSet, baseVersion: 1 }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
  });
});

describe('spec 002 — FR-004/FR-005: validação ao salvar', () => {
  it('FR-004/FR-005: ciclo é rejeitado com 422 e os nós envolvidos', async () => {
    const wf = await create('Ciclo');
    const cyclic = {
      nodes: [...manualSet.nodes, node('s2', 'data.set', 'Definir 2')],
      edges: [edge('m', 's'), edge('s', 's2'), edge('s2', 's')],
      settings: {},
    };
    const res = await editor.call('PUT', `/workflows/${wf.id}`, {
      definition: cyclic,
      baseVersion: 1,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<ApiErrorBody>().error.issues).toEqual([
      expect.objectContaining({ code: 'INVALID_CYCLE', nodeIds: ['s', 's2'] }) as unknown,
    ]);
  });

  it('FR-004/FR-005: nome duplicado e porta inexistente identificam os nós', async () => {
    const res = await editor.call('POST', `/projects/${projectId}/workflows`, {
      name: 'Inválido',
      definition: {
        nodes: [node('m', 'trigger.manual', 'X'), node('s', 'data.set', 'X')],
        edges: [{ id: 'e', from: 'm', fromPort: 'nao', to: 's', toPort: 'main' }],
        settings: {},
      },
    });
    expect(res.statusCode).toBe(422);
    const issues = res.json<ApiErrorBody>().error.issues ?? [];
    expect(issues.map((i) => [i.code, i.nodeIds])).toEqual(
      expect.arrayContaining([
        ['DUPLICATE_NODE_NAME', ['m', 's']],
        ['EDGE_UNKNOWN_PORT', ['m', 's']],
      ]),
    );
  });

  it('FR-004: nó órfão é aceito com aviso', async () => {
    const wf = await create('Órfão', {
      ...manualSet,
      nodes: [...manualSet.nodes, node('o', 'data.set', 'Solto')],
    });
    expect(wf.warnings).toEqual([
      expect.objectContaining({ code: 'ORPHAN_NODE', nodeIds: ['o'] }) as unknown,
    ]);
  });

  it('FR-004: definição malformada → 400 com o caminho do campo', async () => {
    const res = await editor.call('POST', `/projects/${projectId}/workflows`, {
      name: 'Malformado',
      definition: { nodes: [{ id: 'x' }], edges: [], settings: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErrorBody>().error.issues?.[0]?.path?.slice(0, 2)).toEqual([
      'definition',
      'nodes',
    ]);
  });
});

describe('spec 002 — FR-006: catálogo de tipos de nó', () => {
  it('FR-006: qualquer usuário autenticado lista os tipos, com portas e schema, sem execute', async () => {
    const outsider = await loginAs(ctx, { sub: 'x', email: 'x@t.local' });
    const types = (await outsider.call('GET', '/node-types')).json<NodeDescription[]>();
    expect(types.map((t) => t.type)).toEqual([
      // Spec 005: code.javascript, http.respondToWebhook, trigger.webhook.
      'code.javascript',
      'data.set',
      'data.setVariable',
      // Spec 004.
      'http.request',
      'http.respondToWebhook',
      'logic.if',
      // Spec 007: controle de fluxo e workflow de erro.
      'logic.loopOverItems',
      'logic.merge',
      'logic.switch',
      'logic.while',
      'postgres.query',
      'postgres.write',
      'trigger.error',
      'trigger.manual',
      'trigger.webhook',
    ]);
    // Portas calculadas pelos parâmetros (spec 007) vão ao editor de forma declarativa.
    expect(types.find((t) => t.type === 'logic.merge')?.dynamicPorts).toEqual({
      kind: 'mergeInputs',
    });
    expect(types.find((t) => t.type === 'http.request')?.credentialTypes).toContain('httpBearer');
    const set = types.find((t) => t.type === 'data.set');
    expect(set).toMatchObject({
      inputs: [{ name: 'main' }],
      outputs: [{ name: 'main' }],
      paramsSchema: { type: 'object' },
    });
    expect(set).not.toHaveProperty('execute');
  });
});
