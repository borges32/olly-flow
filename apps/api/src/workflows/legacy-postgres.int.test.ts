import type {
  CredentialSummary,
  ProjectSummary,
  WorkflowDefinition,
  WorkflowDetail,
} from '@olly/shared-types';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

/**
 * Spec 022 (T020): workflows gravados com `postgres.query` e `postgres.write` (spec 004) são lidos
 * e executados como o nó PostgreSQL único, com o mesmo resultado, sem reescrever o histórico.
 */
let ctx: TestContext;
let editor: TestUser;
let project: ProjectSummary;
let credentialId: string;

beforeAll(async () => {
  ctx = await startTestContext({
    http: { allowlist: ['127.0.0.1', 'localhost'], maxResponseBytes: 1024 * 1024 },
  });
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@pg.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@pg.local' });
  project = (await admin.call('POST', '/projects', { name: 'Postgres' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  const c = ctx.database.container;
  credentialId = (
    await editor.call('POST', `/projects/${project.id}/credentials`, {
      name: 'Banco',
      type: 'postgres',
      data: {
        host: c.getHost(),
        port: c.getPort(),
        database: c.getDatabase(),
        user: c.getUsername(),
        password: c.getPassword(),
      },
    })
  ).json<CredentialSummary>().id;
  await sql`CREATE TABLE IF NOT EXISTS legado_pg (id int PRIMARY KEY, nome text)`.execute(
    ctx.database.db,
  );
});
afterAll(async () => {
  await ctx.close();
});

const legacy = (): WorkflowDefinition => ({
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'w',
      type: 'postgres.write',
      name: 'Gravar',
      params: {
        operation: 'upsert',
        table: 'legado_pg',
        matchingColumns: [{ column: 'id' }],
        options: { returning: '' },
      },
      credentialId,
      position: [200, 0],
    },
    {
      id: 'q',
      type: 'postgres.query',
      name: 'Consultar',
      params: { query: 'SELECT nome FROM legado_pg ORDER BY id', options: { maxRows: 5 } },
      credentialId,
      position: [400, 0],
    },
  ],
  edges: [
    { id: 'e1', from: 'm', fromPort: 'main', to: 'w', toPort: 'main' },
    { id: 'e2', from: 'w', fromPort: 'main', to: 'q', toPort: 'main' },
  ],
  settings: {},
  pinData: { m: [{ json: { id: 1, nome: 'Ana' } }, { json: { id: 2, nome: 'Bruno' } }] },
});

describe('spec 022 — FR-008/SC-003: workflows com os nós PostgreSQL antigos', () => {
  it('FR-008/SC-003: versão gravada no formato antigo é lida como o nó único e executa igual', async () => {
    // Entrada da API: o salvamento já migra.
    const created = await createWorkflow(editor, project.id, legacy());
    expect(created.definition.nodes.map((n) => n.type)).toEqual([
      'trigger.manual',
      'postgres.database',
      'postgres.database',
    ]);

    // Versão gravada no formato antigo (como antes da spec 022): a leitura migra.
    await sql`UPDATE workflow_versions SET definition = ${JSON.stringify(legacy())}
      WHERE workflow_id = ${created.id}`.execute(ctx.database.db);
    const read = (await editor.call('GET', `/workflows/${created.id}`)).json<WorkflowDetail>();
    expect(read.definition.nodes.find((n) => n.id === 'w')).toMatchObject({
      type: 'postgres.database',
      params: { operation: 'upsert', writeOptions: { returning: '' } },
    });
    expect(read.definition.nodes.find((n) => n.id === 'q')).toMatchObject({
      type: 'postgres.database',
      params: { operation: 'executeQuery', queryOptions: { maxRows: 5 } },
    });

    const detail = await waitForStatus(editor, await startTestRun(editor, read));
    expect(detail.status).toBe('success');
    expect(detail.nodes.find((n) => n.nodeId === 'q')?.output?.main?.map((i) => i.json)).toEqual([
      { nome: 'Ana' },
      { nome: 'Bruno' },
    ]);
    const published = await editor.call('POST', `/workflows/${created.id}/publish`, {
      message: 'Formato antigo',
    });
    expect(published.statusCode).toBe(200);
  });
});
