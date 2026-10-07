import { readFileSync } from 'node:fs';
import type {
  ApiErrorBody,
  CredentialSummary,
  ImportPreview,
  Paginated,
  ProjectSummary,
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowFile,
  WorkflowSummary,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

const SENTINEL = 'SENTINELA-TOKEN-015-9f3a';

let ctx: TestContext;
let admin: TestUser;
let editor: TestUser;
let viewer: TestUser;
let executor: TestUser;
let projectId: string;
let otherProjectId: string;
let credentialId: string;

const definition = (credential?: string): WorkflowDefinition => ({
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'h',
      type: 'http.request',
      name: 'Buscar',
      params: { method: 'GET', url: 'https://api.exemplo.gov.br', authentication: 'credential' },
      position: [260, 0],
      ...(credential && { credentialId: credential }),
    },
  ],
  edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'h', toPort: 'main' }],
  settings: { timeoutSec: 60 },
  pinData: { m: [{ json: { pedido: 7 } }] },
});

const audits = (action: string) =>
  ctx.database.db.selectFrom('audit_log').selectAll().where('action', '=', action).execute();
const countWorkflows = async (project: string) =>
  (await editor.call('GET', `/projects/${project}/workflows`)).json<Paginated<WorkflowSummary>>()
    .total;
const preview = async (project: string, content: unknown, format = 'olly') =>
  (
    await editor.call('POST', `/projects/${project}/workflows/import/preview`, { format, content })
  ).json<ImportPreview>();

beforeAll(async () => {
  ctx = await startTestContext();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@t.local' });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@t.local' });
  projectId = (await admin.call('POST', '/projects', { name: 'Origem' })).json<ProjectSummary>().id;
  otherProjectId = (
    await admin.call('POST', '/projects', { name: 'Destino' })
  ).json<ProjectSummary>().id;
  for (const p of [projectId, otherProjectId]) {
    await admin.call('PUT', `/projects/${p}/members/${editor.id}`, { role: 'editor' });
  }
  await admin.call('PUT', `/projects/${projectId}/members/${viewer.id}`, { role: 'viewer' });
  await admin.call('PUT', `/projects/${projectId}/members/${executor.id}`, { role: 'executor' });
  credentialId = (
    await editor.call('POST', `/projects/${projectId}/credentials`, {
      name: 'API de pedidos',
      type: 'httpBearer',
      data: { token: SENTINEL },
    })
  ).json<CredentialSummary>().id;
});
afterAll(async () => {
  await ctx.close();
});

async function createWorkflow(name: string, def: WorkflowDefinition = definition(credentialId)) {
  const res = await editor.call('POST', `/projects/${projectId}/workflows`, {
    name,
    definition: def,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<WorkflowDetail>();
}

describe('spec 015 — HU-1: baixar o workflow', () => {
  it('FR-006/FR-007/FR-009/SC-002: rascunho salvo como arquivo, com a credencial só referenciada e os dados fixados', async () => {
    const wf = await createWorkflow('Pedidos ção');
    const res = await editor.call('GET', `/workflows/${wf.id}/export`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="Pedidos __o.json"; filename*=UTF-8''${encodeURIComponent('Pedidos ção.json')}`,
    );
    const file = res.json<WorkflowFile>();
    expect(file).toMatchObject({
      name: 'Pedidos ção',
      active: false,
      settings: { executionTimeout: 60 },
      meta: { ollyFlow: { formatVersion: 1, workflowVersion: 1 } },
      pinData: { Início: [{ json: { pedido: 7 } }] },
      connections: { Início: { main: [[{ node: 'Buscar', type: 'main', index: 0 }]] } },
    });
    expect(file.nodes[1]?.credentials).toEqual({
      httpBearer: { id: credentialId, name: 'API de pedidos' },
    });
    expect(res.body).not.toContain(SENTINEL);
  });

  it('FR-006: exporta o canvas com alterações não salvas', async () => {
    const wf = await createWorkflow('Canvas');
    const canvas = definition(credentialId);
    canvas.nodes.push({
      id: 'n',
      type: 'data.set',
      name: 'Novo nó',
      params: {},
      position: [520, 0],
    });
    const res = await editor.call('POST', `/workflows/${wf.id}/export`, {
      definition: canvas,
      name: 'Canvas editado',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('Canvas editado.json');
    expect(res.json<WorkflowFile>().nodes.map((n) => n.name)).toEqual([
      'Início',
      'Buscar',
      'Novo nó',
    ]);
  });

  it('FR-008: só Editor e Admin do projeto baixam; a exportação é auditada sem o conteúdo', async () => {
    const wf = await createWorkflow('Permissões');
    expect((await viewer.call('GET', `/workflows/${wf.id}/export`)).statusCode).toBe(403);
    expect((await executor.call('GET', `/workflows/${wf.id}/export`)).statusCode).toBe(403);
    expect(
      (await viewer.call('POST', `/workflows/${wf.id}/export`, { definition: definition() }))
        .statusCode,
    ).toBe(403);
    expect((await admin.call('GET', `/workflows/${wf.id}/export`)).statusCode).toBe(200);
    const rows = (await audits('workflow.export')).filter((r) => r.entity_id === wf.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toEqual({ projectId, source: 'saved', nodes: 2 });
    expect(JSON.stringify(await audits('workflow.export'))).not.toContain(SENTINEL);
  });
});

describe('spec 015 — HU-2: importar um JSON do Olly Flow', () => {
  it('FR-010/FR-011/FR-014/FR-017: importa em outro projeto, liga a credencial pelo nome e tipo e audita', async () => {
    const wf = await createWorkflow('Para importar');
    const file = (await editor.call('GET', `/workflows/${wf.id}/export`)).json<WorkflowFile>();

    // Sem credencial correspondente no destino: pendência.
    const first = await preview(otherProjectId, JSON.stringify(file));
    expect(first).toMatchObject({
      name: 'Para importar',
      format: 'olly',
      counts: { nodes: 2, connections: 1 },
      errors: [],
    });
    expect(first.pending).toEqual([
      expect.objectContaining({ code: 'CREDENTIAL_PENDING', node: 'Buscar' }),
    ]);

    const target = (
      await editor.call('POST', `/projects/${otherProjectId}/credentials`, {
        name: 'API de pedidos',
        type: 'httpBearer',
        data: { token: 'outro' },
      })
    ).json<CredentialSummary>();
    expect((await preview(otherProjectId, file)).pending).toEqual([]);

    const res = await editor.call('POST', `/projects/${otherProjectId}/workflows/import`, {
      format: 'olly',
      content: file,
      name: 'Importado',
    });
    expect(res.statusCode, res.body).toBe(201);
    const { workflow } = res.json<{ workflow: WorkflowDetail; preview: ImportPreview }>();
    expect(workflow).toMatchObject({
      name: 'Importado',
      projectId: otherProjectId,
      publishedVersion: null,
      active: false,
    });
    expect(workflow.definition.nodes.find((n) => n.name === 'Buscar')?.credentialId).toBe(
      target.id,
    );
    expect(Object.values(workflow.definition.pinData ?? {})).toEqual([[{ json: { pedido: 7 } }]]);
    const audit = (await audits('workflow.import')).find((r) => r.entity_id === workflow.id);
    expect(audit?.details).toEqual({
      projectId: otherProjectId,
      format: 'olly',
      overwritten: false,
      nodes: 2,
      pending: 0,
      unsupported: 0,
    });
  });

  it('FR-011/FR-012/SC-005: arquivo com erro é recusado com o nó e o motivo, sem criar nada', async () => {
    const before = await countWorkflows(projectId);
    const invalid = await preview(projectId, '{"nodes": [');
    expect(invalid.errors[0]?.code).toBe('IMPORT_INVALID_JSON');
    const agentWithoutModel = {
      nodes: [{ name: 'Agente', type: 'ai.agent' }],
      connections: {},
    };
    const structural = await preview(projectId, agentWithoutModel);
    expect(structural.errors).toEqual([
      expect.objectContaining({ code: 'AGENT_MODEL_REQUIRED', node: 'Agente' }),
    ]);
    const hostile = await preview(
      projectId,
      '{"nodes":[{"name":"A","type":"data.set","parameters":{"__proto__":{"x":1}}}],"connections":{}}',
    );
    expect(hostile.errors[0]?.code).toBe('IMPORT_FORBIDDEN_KEY');
    const res = await editor.call('POST', `/projects/${projectId}/workflows/import`, {
      content: agentWithoutModel,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<ApiErrorBody>().error.issues?.[0]?.code).toBe('AGENT_MODEL_REQUIRED');
    expect(await countWorkflows(projectId)).toBe(before);
  });

  it('FR-013: arquivo sem ids, posições e parâmetros (como gerado por IA) é completado', async () => {
    const res = await editor.call('POST', `/projects/${projectId}/workflows/import`, {
      content: {
        name: 'Gerado por IA',
        nodes: [
          { name: 'Início', type: 'trigger.manual' },
          {
            name: 'Definir',
            type: 'data.set',
            parameters: { fields: [{ name: 'a', type: 'string', value: 'x' }] },
          },
        ],
        connections: { Início: { main: [[{ node: 'Definir', type: 'main', index: 0 }]] } },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const nodes = res.json<{ workflow: WorkflowDetail }>().workflow.definition.nodes;
    expect(nodes.map((n) => n.position)).toEqual([
      [0, 0],
      [260, 0],
    ]);
    expect(nodes[1]?.params).toMatchObject({ includeOtherFields: false });
    expect(nodes.every((n) => /^[0-9a-f-]{36}$/.test(n.id))).toBe(true);
  });

  it('FR-015: referências de outra instalação viram pendências; o workflow de erro inexistente é retirado', async () => {
    const published = await createWorkflow('Webhook publicado', {
      nodes: [
        {
          id: 'w',
          type: 'trigger.webhook',
          name: 'Webhook',
          params: { httpMethod: 'POST', path: 'pedidos-015', authentication: 'none' },
          position: [0, 0],
        },
      ],
      edges: [],
      settings: {},
    });
    expect(
      (await editor.call('POST', `/workflows/${published.id}/publish`, { message: 'Publicar' }))
        .statusCode,
    ).toBe(200);
    const res = await editor.call('POST', `/projects/${projectId}/workflows/import`, {
      content: {
        name: 'Referências externas',
        nodes: [
          {
            name: 'Webhook',
            type: 'trigger.webhook',
            parameters: { httpMethod: 'POST', path: 'pedidos-015' },
          },
          {
            name: 'Chamar',
            type: 'flow.executeWorkflow',
            parameters: { workflowId: '00000000-0000-4000-8000-000000000015' },
          },
          { name: 'Modelo', type: 'ai.chatModel', parameters: { model: 'modelo-nao-liberado' } },
          { name: 'MCP', type: 'tool.mcp', parameters: { serverId: '' } },
        ],
        connections: { Webhook: { main: [[{ node: 'Chamar', type: 'main', index: 0 }]] } },
        settings: { errorWorkflow: '00000000-0000-4000-8000-0000000000ee' },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { workflow, preview: p } = res.json<{
      workflow: WorkflowDetail;
      preview: ImportPreview;
    }>();
    expect(p.pending.map((x) => x.code).sort()).toEqual(
      [
        'AI_MODEL_NOT_ALLOWED',
        'ERROR_WORKFLOW_REMOVED',
        'MCP_SERVER_NOT_FOUND',
        'WEBHOOK_PATH_IN_USE',
        'WORKFLOW_REF_NOT_FOUND',
      ].sort(),
    );
    expect(workflow.definition.settings.errorWorkflowId).toBeUndefined();
    expect(workflow.publishedVersion).toBeNull();
  });

  it('FR-016: tipo desconhecido vira marcador desabilitado e a publicação é bloqueada', async () => {
    const res = await editor.call('POST', `/projects/${projectId}/workflows/import`, {
      content: {
        name: 'Com marcador',
        nodes: [
          { name: 'Início', type: 'trigger.manual' },
          { name: 'Planilha', type: 'outra.planilha', parameters: { aba: 'A' } },
        ],
        connections: { Início: { main: [[{ node: 'Planilha', type: 'main', index: 0 }]] } },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { workflow } = res.json<{ workflow: WorkflowDetail }>();
    expect(workflow.definition.nodes[1]).toMatchObject({
      type: 'placeholder.unsupported',
      disabled: true,
      params: { originalType: 'outra.planilha' },
    });
    const publish = await editor.call('POST', `/workflows/${workflow.id}/publish`, {
      message: 'Tentar',
    });
    expect(publish.statusCode).toBe(422);
    expect(publish.json<ApiErrorBody>().error.issues).toEqual([
      expect.objectContaining({
        code: 'UNSUPPORTED_NODE',
        nodeIds: [workflow.definition.nodes[1]?.id],
      }),
    ]);
  });

  it('FR-017: importar exige criar workflows no projeto', async () => {
    const res = await viewer.call('POST', `/projects/${projectId}/workflows/import/preview`, {
      content: { nodes: [], connections: {} },
    });
    expect(res.statusCode).toBe(403);
    expect(
      (
        await viewer.call('POST', `/projects/${projectId}/workflows/import`, {
          content: { nodes: [], connections: {} },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('NFR-002: arquivo acima dos limites é recusado citando o limite', async () => {
    const big = JSON.stringify({
      nodes: [],
      connections: {},
      name: 'x'.repeat(ctx.config.workflowImport.maxBytes),
    });
    const res = await editor.call('POST', `/projects/${projectId}/workflows/import/preview`, {
      content: big,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json<ApiErrorBody>().error.message).toContain('OLLY_IMPORT_MAX_BYTES');
    const many = {
      nodes: Array.from({ length: ctx.config.workflowImport.maxNodes + 1 }, (_, i) => ({
        name: `n${String(i)}`,
        type: 'data.set',
      })),
      connections: {},
    };
    const tooMany = await preview(projectId, many);
    expect(tooMany.errors[0]).toMatchObject({ code: 'IMPORT_TOO_MANY_NODES' });
    expect(tooMany.errors[0]?.message).toContain(String(ctx.config.workflowImport.maxNodes));
  });

  it('NFR-004: a prévia de um workflow com 200 nós fica pronta em menos de 2 s', async () => {
    const nodes = [
      { name: 'n0', type: 'trigger.manual' },
      ...Array.from({ length: 199 }, (_, i) => ({ name: `n${String(i + 1)}`, type: 'data.set' })),
    ];
    const connections = Object.fromEntries(
      nodes
        .slice(0, -1)
        .map((n, i) => [
          n.name,
          { main: [[{ node: `n${String(i + 1)}`, type: 'main', index: 0 }]] },
        ]),
    );
    const started = performance.now();
    const p = await preview(projectId, { nodes, connections });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(p).toMatchObject({ errors: [], counts: { nodes: 200, connections: 199 } });
  });
});

describe('spec 015 — FR-010/FR-028: importar o JSON de um workflow existente sobrepõe o rascunho', () => {
  const importFile = (content: unknown, project = projectId) =>
    editor.call('POST', `/projects/${project}/workflows/import`, { content });

  it('FR-028: pelo id do arquivo, sobrepõe como nova versão, sem criar outro workflow', async () => {
    const wf = await createWorkflow('Sobrepor por id');
    const file = (await editor.call('GET', `/workflows/${wf.id}/export`)).json<WorkflowFile>();
    file.name = 'Nome diferente no arquivo';
    file.nodes.push({ name: 'Novo', type: 'data.set', parameters: { fields: [] } });
    file.connections.Buscar = { main: [[{ node: 'Novo', type: 'main', index: 0 }]] };
    const before = await countWorkflows(projectId);

    const p = await preview(projectId, file);
    expect(p.target).toEqual({
      workflowId: wf.id,
      name: 'Sobrepor por id',
      version: 1,
      published: false,
      matchedBy: 'id',
    });

    const res = await importFile(file);
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json<{ workflow: WorkflowDetail; overwritten: boolean }>();
    expect(body.overwritten).toBe(true);
    expect(body.workflow).toMatchObject({ id: wf.id, name: 'Sobrepor por id', version: 2 });
    expect(body.workflow.definition.nodes.map((n) => n.name)).toEqual(['Início', 'Buscar', 'Novo']);
    // Os ids dos nós do arquivo baixado são mantidos (o histórico compara nó a nó).
    expect(body.workflow.definition.nodes.slice(0, 2).map((n) => n.id)).toEqual(['m', 'h']);
    expect(await countWorkflows(projectId)).toBe(before);
    const versions = (await editor.call('GET', `/workflows/${wf.id}/versions`)).json<
      { version: number; message: string | null }[]
    >();
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]?.message).toBe('Importado de arquivo JSON');
    const audit = (await audits('workflow.import')).find((r) => r.entity_id === wf.id);
    expect(audit?.details).toMatchObject({ overwritten: true, nodes: 3 });
  });

  it('FR-028: sem id correspondente, pelo nome único; com nomes repetidos, cria um novo e avisa', async () => {
    const wf = await createWorkflow('Sobrepor por nome');
    const content = {
      name: 'Sobrepor por nome',
      nodes: [{ name: 'Só um nó', type: 'trigger.manual' }],
      connections: {},
    };
    expect((await preview(projectId, content)).target).toMatchObject({
      workflowId: wf.id,
      matchedBy: 'name',
    });
    const res = await importFile(content);
    expect(res.json<{ workflow: WorkflowDetail; overwritten: boolean }>()).toMatchObject({
      overwritten: true,
      workflow: { id: wf.id, version: 2 },
    });

    await createWorkflow('Nome repetido');
    await createWorkflow('Nome repetido');
    const before = await countWorkflows(projectId);
    const ambiguous = { ...content, name: 'Nome repetido' };
    const p = await preview(projectId, ambiguous);
    expect(p.target).toBeUndefined();
    expect(p.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'IMPORT_NAME_AMBIGUOUS' })]),
    );
    const created = await importFile(ambiguous);
    expect(created.json<{ overwritten: boolean }>().overwritten).toBe(false);
    expect(await countWorkflows(projectId)).toBe(before + 1);
  });

  it('FR-028: workflow publicado: só o rascunho muda, com aviso; em outro projeto, cria um novo', async () => {
    const wf = await createWorkflow('Publicado e sobreposto', {
      nodes: [{ id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] }],
      edges: [],
      settings: {},
    });
    expect(
      (await editor.call('POST', `/workflows/${wf.id}/publish`, { message: 'v1' })).statusCode,
    ).toBe(200);
    const file = (await editor.call('GET', `/workflows/${wf.id}/export`)).json<WorkflowFile>();
    const p = await preview(projectId, file);
    expect(p.target).toMatchObject({ workflowId: wf.id, published: true });
    expect(p.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'IMPORT_TARGET_PUBLISHED' })]),
    );
    const res = await importFile(file);
    expect(res.json<{ workflow: WorkflowDetail }>().workflow).toMatchObject({
      id: wf.id,
      version: 2,
      publishedVersion: 1,
      active: true,
    });

    const elsewhere = await importFile(file, otherProjectId);
    const other = elsewhere.json<{ workflow: WorkflowDetail; overwritten: boolean }>();
    expect(other.overwritten).toBe(false);
    expect(other.workflow.id).not.toBe(wf.id);
    expect(other.workflow.projectId).toBe(otherProjectId);
  });
});

describe('spec 015 — HU-3: importar do N8N', () => {
  const n8nFixture = () =>
    JSON.parse(
      readFileSync(
        new URL('../../../../fixtures/n8n/exemplo-set-if/workflow.json', import.meta.url),
        'utf8',
      ),
    ) as unknown;

  it('FR-010/FR-023/FR-026: prévia com o relatório de migração e importação como rascunho', async () => {
    const p = await preview(projectId, n8nFixture(), 'n8n');
    expect(p).toMatchObject({ format: 'n8n', errors: [], counts: { nodes: 3, connections: 2 } });
    expect(p.migration?.nodes.converted.map((n) => n.to)).toEqual([
      'trigger.manual',
      'data.set',
      'logic.if',
    ]);
    const res = await editor.call('POST', `/projects/${projectId}/workflows/import`, {
      format: 'n8n',
      content: n8nFixture(),
    });
    expect(res.statusCode, res.body).toBe(201);
    const { workflow } = res.json<{ workflow: WorkflowDetail }>();
    expect(workflow.name).toBe('Exemplo Set + If (sintético)');
    const audit = (await audits('workflow.import')).find((r) => r.entity_id === workflow.id);
    expect(audit?.details).toMatchObject({ format: 'n8n', nodes: 3 });
  });

  it('formato trocado: arquivo do N8N como Olly Flow, e o contrário, sugerem o outro formato', async () => {
    expect((await preview(projectId, n8nFixture(), 'olly')).errors[0]?.code).toBe('N8N_FILE');
    expect(
      (
        await preview(
          projectId,
          { nodes: [{ name: 'A', type: 'data.set' }], connections: {} },
          'n8n',
        )
      ).errors[0]?.code,
    ).toBe('OLLY_FILE');
  });
});
