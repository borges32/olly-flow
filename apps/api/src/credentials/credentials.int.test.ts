import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  CredentialSummary,
  CredentialTestResponse,
  ExecutionDetail,
  ProjectSummary,
  TestRunResponse,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';
import { CredentialsService } from './credentials.service.js';

let ctx: TestContext;
let admin: TestUser, editor: TestUser, executor: TestUser, viewer: TestUser, outsider: TestUser;
let limited: TestUser;
let project: ProjectSummary, other: ProjectSummary;
let server: Server;
let base: string;
const TOKEN = 'token-de-teste-bearer-123';

async function waitFinished(user: TestUser, executionId: string): Promise<ExecutionDetail> {
  for (let i = 0; i < 100; i++) {
    const detail = (await user.call('GET', `/executions/${executionId}`)).json<ExecutionDetail>();
    if (!['queued', 'running'].includes(detail.status)) return detail;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('execução não terminou');
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const ok = req.headers.authorization === `Bearer ${TOKEN}`;
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ autorizado: ok, caminho: req.url }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 },
  });
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@t.local' });
  viewer = await loginAs(ctx, { sub: 'viewer', email: 'viewer@t.local' });
  outsider = await loginAs(ctx, { sub: 'outsider', email: 'outsider@t.local' });
  limited = await loginAs(ctx, { sub: 'limited', email: 'limited@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'Integrações' })).json<ProjectSummary>();
  other = (await admin.call('POST', '/projects', { name: 'Outro' })).json<ProjectSummary>();
  for (const [u, role] of [
    [editor, 'editor'],
    [executor, 'executor'],
    [viewer, 'viewer'],
  ] as const) {
    await admin.call('PUT', `/projects/${project.id}/members/${u.id}`, { role });
  }
  await admin.call('PUT', `/projects/${other.id}/members/${editor.id}`, { role: 'editor' });
  // Papel personalizado: edita workflows, mas não pode usar credenciais (FR-007).
  const role = await ctx.database.db
    .insertInto('roles')
    .values({
      name: 'editor-sem-credencial',
      permissions: ['workflow:read', 'workflow:update', 'workflow:execute', 'execution:read'],
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.database.db
    .insertInto('project_members')
    .values({ project_id: project.id, user_id: limited.id, role_id: role.id })
    .execute();
});
afterAll(async () => {
  server.close();
  await ctx.close();
});

const bearer = (name = 'API', token = TOKEN) => ({ name, type: 'httpBearer', data: { token } });
const pgData = () => {
  const c = ctx.database.container;
  return {
    host: c.getHost(),
    port: c.getPort(),
    database: c.getDatabase(),
    user: c.getUsername(),
    password: c.getPassword(),
    ssl: 'disable',
  };
};
const create = async (user: TestUser, body: object, projectId = project.id) =>
  user.call('POST', `/projects/${projectId}/credentials`, body);

describe('spec 004 — FR-002/FR-007: API de credenciais e permissões', () => {
  it('FR-002: cria e lista sem devolver segredos; indica quais secretos têm valor', async () => {
    const res = await create(editor, {
      name: 'Basic API',
      type: 'httpBasic',
      data: { user: 'ana', password: 'senha-secreta-xyz' },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<CredentialSummary>();
    expect(created).toMatchObject({
      name: 'Basic API',
      type: 'httpBasic',
      projectId: project.id,
      publicFields: { user: 'ana' },
      secretFieldsSet: ['password'],
    });
    const list = await editor.call('GET', `/projects/${project.id}/credentials`);
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain('senha-secreta-xyz');
    expect((await editor.call('GET', `/credentials/${created.id}`)).body).not.toContain(
      'senha-secreta-xyz',
    );
  });

  it('FR-004: valida os dados pelo tipo; tipo desconhecido e nome repetido são recusados', async () => {
    const missing = await create(editor, { name: 'Sem token', type: 'httpBearer', data: {} });
    expect(missing.statusCode).toBe(422);
    expect(missing.body).toContain('token');
    expect((await create(editor, { name: 'X', type: 'ftp', data: {} })).statusCode).toBe(422);
    expect((await create(editor, bearer('Repetida'))).statusCode).toBe(201);
    expect((await create(editor, bearer('Repetida'))).statusCode).toBe(409);
    const pg = (
      await create(editor, {
        name: 'PG padrão',
        type: 'postgres',
        data: { ...pgData(), port: undefined },
      })
    ).json<CredentialSummary>();
    expect(pg.publicFields).toMatchObject({ port: 5432, ssl: 'disable', readOnly: false });
  });

  it('HU-1.1: editar com segredo em branco mantém o valor atual; preenchido, troca', async () => {
    const { id } = (
      await create(editor, bearer('Editável', 'valor-original-abc'))
    ).json<CredentialSummary>();
    const service = ctx.app.get(CredentialsService);
    const renamed = await editor.call('PUT', `/credentials/${id}`, {
      name: 'Renomeada',
      data: { token: '' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<CredentialSummary>().name).toBe('Renomeada');
    expect((await service.resolveForExecution(project.id, id)).credential.data.token).toBe(
      'valor-original-abc',
    );
    await editor.call('PUT', `/credentials/${id}`, { data: { token: 'valor-novo-def' } });
    expect((await service.resolveForExecution(project.id, id)).credential.data.token).toBe(
      'valor-novo-def',
    );
  });

  it('FR-001: os dados ficam cifrados no banco, com versão da chave', async () => {
    const { id } = (
      await create(editor, bearer('Cifrada', 'segredo-no-banco-777'))
    ).json<CredentialSummary>();
    const row = await ctx.database.db
      .selectFrom('credentials')
      .select(['data_encrypted', 'key_version'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.key_version).toBe(1);
    expect(row.data_encrypted.toString('utf8')).not.toContain('segredo-no-banco-777');
  });

  it('FR-007/T089: gestão exige credential:manage; listar exige credential:use; de fora, 404', async () => {
    const { id } = (await create(editor, bearer('Permissões'))).json<CredentialSummary>();
    for (const user of [executor, viewer]) {
      expect((await user.call('GET', `/projects/${project.id}/credentials`)).statusCode).toBe(403);
      expect((await create(user, bearer('Não pode'))).statusCode).toBe(403);
      expect((await user.call('GET', `/credentials/${id}`)).statusCode).toBe(403);
      expect((await user.call('PUT', `/credentials/${id}`, { name: 'x' })).statusCode).toBe(403);
      expect((await user.call('DELETE', `/credentials/${id}`)).statusCode).toBe(403);
      expect((await user.call('POST', `/credentials/${id}/test`, {})).statusCode).toBe(403);
      expect((await user.call('GET', `/credentials/${id}/postgres/schemas`)).statusCode).toBe(403);
    }
    expect((await outsider.call('GET', `/projects/${project.id}/credentials`)).statusCode).toBe(
      404,
    );
    expect((await outsider.call('GET', `/credentials/${id}`)).statusCode).toBe(404);
    expect((await outsider.call('DELETE', `/credentials/${id}`)).statusCode).toBe(404);
    expect((await admin.call('GET', `/credentials/${id}`)).statusCode).toBe(200);
  });

  it('FR-004: GET /credential-types descreve os tipos e marca os campos secretos', async () => {
    const res = await viewer.call('GET', '/credential-types');
    expect(res.statusCode).toBe(200);
    const types =
      res.json<
        { name: string; properties: { properties: Record<string, Record<string, unknown>> } }[]
      >();
    expect(types.map((t) => t.name).sort()).toEqual([
      // Spec 016: Agentix e Bridge.
      'agentixApi',
      // Spec 011: provedores de modelo (`fakeLlm` só com NODE_ENV=test, como nos testes).
      'anthropic',
      'bridgeApi',
      'fakeLlm',
      'googleGemini',
      'httpBasic',
      'httpBearer',
      'httpHeaderAuth',
      'httpQueryAuth',
      // Spec 010: servidores MCP.
      'mcpBearer',
      'mcpHeaders',
      'mcpOAuth',
      'oauth2ClientCredentials',
      'openAiCompatible',
      'postgres',
      // Spec 005: autenticação de webhooks recebidos.
      'webhookBasicAuth',
      'webhookHeaderAuth',
      'webhookHmac',
    ]);
    expect(
      types.find((t) => t.name === 'postgres')?.properties.properties.password?.['x-secret'],
    ).toBe(true);
  });
});

describe('spec 004 — FR-005/FR-006: teste de conexão e auditoria', () => {
  it('FR-005: Postgres conecta; senha errada falha sem mostrar a senha', async () => {
    const good = (
      await create(editor, { name: 'PG ok', type: 'postgres', data: pgData() })
    ).json<CredentialSummary>();
    const ok = await editor.call('POST', `/credentials/${good.id}/test`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json<CredentialTestResponse>()).toEqual({
      ok: true,
      message: 'Conexão bem-sucedida',
    });
    const bad = (
      await create(editor, {
        name: 'PG ruim',
        type: 'postgres',
        data: { ...pgData(), password: 'senha-errada-999' },
      })
    ).json<CredentialSummary>();
    const fail = (
      await editor.call('POST', `/credentials/${bad.id}/test`)
    ).json<CredentialTestResponse>();
    expect(fail.ok).toBe(false);
    expect(fail.message).not.toContain('senha-errada-999');
  });

  it('FR-005: tipos HTTP testam com uma URL, pelo filtro anti-SSRF', async () => {
    const { id } = (await create(editor, bearer('HTTP teste'))).json<CredentialSummary>();
    expect((await editor.call('POST', `/credentials/${id}/test`, {})).statusCode).toBe(422);
    const ok = await editor.call('POST', `/credentials/${id}/test`, { url: `${base}/me` });
    expect(ok.json<CredentialTestResponse>()).toEqual({ ok: true, message: 'Resposta 200' });
    const blocked = await editor.call('POST', `/credentials/${id}/test`, {
      url: 'http://169.254.169.254/',
    });
    expect(blocked.json<CredentialTestResponse>()).toMatchObject({
      ok: false,
      message: expect.stringContaining('Destino bloqueado') as string,
    });
  });

  it('FR-006: criar, alterar, testar e excluir ficam na auditoria, sem os valores', async () => {
    const { id } = (
      await create(editor, bearer('Auditada', 'segredo-auditoria-555'))
    ).json<CredentialSummary>();
    await editor.call('PUT', `/credentials/${id}`, { data: { token: 'segredo-auditoria-666' } });
    await editor.call('POST', `/credentials/${id}/test`, { url: `${base}/x` });
    expect((await editor.call('DELETE', `/credentials/${id}`)).statusCode).toBe(204);
    const rows = await ctx.database.db
      .selectFrom('audit_log')
      .select(['action', 'user_id', 'details'])
      .where('entity_id', '=', id)
      .orderBy('id')
      .execute();
    expect(rows.map((r) => r.action)).toEqual([
      'credential.create',
      'credential.update',
      'credential.test',
      'credential.delete',
    ]);
    expect(rows.every((r) => r.user_id === editor.id)).toBe(true);
    expect(rows[1]?.details).toMatchObject({ fields: ['token'] });
    expect(JSON.stringify(rows)).not.toMatch(/segredo-auditoria/);
    expect((await editor.call('GET', `/credentials/${id}`)).statusCode).toBe(404);
  });
});

describe('spec 004 — FR-016: catálogo do banco da credencial', () => {
  it('FR-016: lista schemas, tabelas e colunas; credencial que não é Postgres dá 422', async () => {
    const { id } = (
      await create(editor, { name: 'PG catálogo', type: 'postgres', data: pgData() })
    ).json<CredentialSummary>();
    expect(
      (await editor.call('GET', `/credentials/${id}/postgres/schemas`)).json<string[]>(),
    ).toContain('public');
    expect(
      (await editor.call('GET', `/credentials/${id}/postgres/tables?schema=public`)).json<
        string[]
      >(),
    ).toContain('projects');
    const columns = (
      await editor.call('GET', `/credentials/${id}/postgres/columns?schema=public&table=projects`)
    ).json<{ name: string }[]>();
    expect(columns.map((c) => c.name)).toEqual(expect.arrayContaining(['id', 'name']));
    expect((await editor.call('GET', `/credentials/${id}/postgres/tables`)).statusCode).toBe(400);
    const http = (await create(editor, bearer('Não é PG'))).json<CredentialSummary>();
    expect((await editor.call('GET', `/credentials/${http.id}/postgres/schemas`)).statusCode).toBe(
      422,
    );
  });
});

describe('spec 004 — FR-007: uso de credenciais em workflows', () => {
  const httpDef = (credentialId: string, url = `${base}/dados`): WorkflowDefinition => ({
    nodes: [
      { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
      {
        id: 'h',
        type: 'http.request',
        name: 'API',
        params: { url, authentication: 'credential' },
        credentialId,
        position: [200, 0],
      },
    ],
    edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'h', toPort: 'main' }],
    settings: {},
  });
  const newWorkflow = async (definition?: WorkflowDefinition) =>
    (
      await editor.call('POST', `/projects/${project.id}/workflows`, {
        name: `wf-${Math.random()}`,
        ...(definition && { definition }),
      })
    ).json<WorkflowDetail>();

  it('FR-007/HU-2.1: editor salva nó com credencial e a execução usa o segredo', async () => {
    const { id } = (await create(editor, bearer('Para workflow'))).json<CredentialSummary>();
    const wf = await newWorkflow(httpDef(id));
    expect(wf.definition.nodes[1]?.credentialId).toBe(id);
    const { executionId } = (
      await editor.call('POST', `/workflows/${wf.id}/test-run`, { definition: httpDef(id) })
    ).json<TestRunResponse>();
    const detail = await waitFinished(editor, executionId);
    expect(detail.status).toBe('success');
    expect(detail.nodes.find((n) => n.nodeId === 'h')?.output?.main?.[0]?.json).toEqual({
      autorizado: true,
      caminho: '/dados',
    });
  });

  it('FR-007: credencial de outro projeto ou de tipo errado é recusada ao salvar', async () => {
    const foreign = (
      await create(editor, bearer('De outro projeto'), other.id)
    ).json<CredentialSummary>();
    const wf = await newWorkflow();
    const res = await editor.call('PUT', `/workflows/${wf.id}`, {
      definition: httpDef(foreign.id),
      baseVersion: wf.version,
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('CREDENTIAL_NOT_FOUND');
    const pg = (
      await create(editor, { name: 'PG em HTTP', type: 'postgres', data: pgData() })
    ).json<CredentialSummary>();
    const mismatch = await editor.call('PUT', `/workflows/${wf.id}`, {
      definition: httpDef(pg.id),
      baseVersion: wf.version,
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.body).toContain('CREDENTIAL_TYPE_MISMATCH');
  });

  it('FR-007: sem credential:use, não associa credencial ao salvar, mas salva o resto', async () => {
    const { id } = (await create(editor, bearer('Restrita'))).json<CredentialSummary>();
    const wf = await newWorkflow(httpDef(id));
    expect(
      (
        await limited.call('PUT', `/workflows/${wf.id}`, {
          definition: httpDef(id, `${base}/outro`),
          baseVersion: wf.version,
        })
      ).statusCode,
    ).toBe(200);
    const other2 = (await create(editor, bearer('Restrita 2'))).json<CredentialSummary>();
    const res = await limited.call('PUT', `/workflows/${wf.id}`, {
      definition: httpDef(other2.id),
      baseVersion: wf.version + 1,
    });
    expect(res.statusCode).toBe(403);
  });

  it('FR-007: sem credential:use, só executa a versão salva de workflow com credencial', async () => {
    const { id } = (await create(editor, bearer('Executor'))).json<CredentialSummary>();
    const def = httpDef(id);
    const wf = await newWorkflow(def);
    const saved = await executor.call('POST', `/workflows/${wf.id}/test-run`, {
      definition: { ...def, nodes: def.nodes.map((n) => ({ ...n, position: [9, 9] })) },
    });
    expect(saved.statusCode).toBe(202);
    expect((await waitFinished(executor, saved.json<TestRunResponse>().executionId)).status).toBe(
      'success',
    );
    const changed = await executor.call('POST', `/workflows/${wf.id}/test-run`, {
      definition: httpDef(id, 'https://servidor-do-atacante.exemplo/'),
    });
    expect(changed.statusCode).toBe(403);
    const pinned = await executor.call('POST', `/workflows/${wf.id}/test-run`, {
      definition: def,
      pinData: { m: [{ json: { url: 'https://servidor-do-atacante.exemplo/' } }] },
    });
    expect(pinned.statusCode).toBe(403);
  });

  it('FR-007: na execução, credencial de outro projeto não é entregue ao nó', async () => {
    const foreign = (
      await create(editor, bearer('Estrangeira'), other.id)
    ).json<CredentialSummary>();
    const wf = await newWorkflow();
    const { executionId } = (
      await editor.call('POST', `/workflows/${wf.id}/test-run`, { definition: httpDef(foreign.id) })
    ).json<TestRunResponse>();
    const detail = await waitFinished(editor, executionId);
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toBe('Credencial não encontrada neste projeto');
  });
});
