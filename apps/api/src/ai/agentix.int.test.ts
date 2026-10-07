import { Writable } from 'node:stream';
import { startAgentixMock, type AgentixMock } from '@olly/nodes';
import type {
  CredentialSummary,
  ProjectSummary,
  WorkflowDefinition,
  WorkflowNode,
} from '@olly/shared-types';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

/**
 * Spec 016, HU-2 (T031): o nó Agentix numa execução pela fila, contra o Agentix simulado
 * (NFR-003): "continuar" por item, cancelamento durante a espera e a chave fora dos registros.
 */
let ctx: TestContext;
let editor: TestUser;
let project: ProjectSummary;
let agentix: AgentixMock;
let credentialId: string;
const logs: string[] = [];
const responses: string[] = [];

beforeAll(async () => {
  agentix = await startAgentixMock({
    scenarios: {
      falha: { states: ['RUNNING', 'FAILED'], errorMessage: 'o agente quebrou' },
      demorado: { states: ['RUNNING'] },
    },
  });
  const logStream = new Writable({
    write(chunk: Buffer, _enc, done) {
      logs.push(chunk.toString('utf8'));
      done();
    },
  });
  ctx = await startTestContext(
    { logLevel: 'trace', http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 } },
    { logStream },
  );
  const admin = await loginAs(ctx, {
    sub: 'admin',
    email: 'admin@agentix.local',
    groups: ['admin'],
  });
  const plain = await loginAs(ctx, { sub: 'editor', email: 'editor@agentix.local' });
  editor = {
    ...plain,
    call: async (method, path, payload) => {
      const res = await plain.call(method, path, payload);
      responses.push(res.body);
      return res;
    },
  };
  project = (await admin.call('POST', '/projects', { name: 'Agentix' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  const created = await editor.call('POST', `/projects/${project.id}/credentials`, {
    name: 'Agentix homologação',
    type: 'agentixApi',
    data: { baseUrl: agentix.baseUrl, apiKey: agentix.apiKey },
  });
  expect(created.statusCode).toBe(201);
  credentialId = created.json<CredentialSummary>().id;
});
afterAll(async () => {
  await ctx.close();
  await agentix.close();
});

function workflow(
  items: Record<string, unknown>[],
  extra: Partial<WorkflowNode> = {},
  options: Record<string, unknown> = {},
): WorkflowDefinition {
  return {
    nodes: [
      { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
      {
        id: 'ax',
        type: 'ai.agentix',
        name: 'Agentix',
        params: {
          entityType: 'agent',
          entityName: '={{ $json.entidade }}',
          entityVersion: '0.1.0',
          bundle: 'olly-kb',
          bundleVersion: '0.1.0.dev10',
          payload: '={{ { pergunta: $json.pergunta } }}',
          constants: '{}',
          waitForCompletion: true,
          output: 'finalAnswer',
          options: { pollIntervalSeconds: 0.1, timeoutSeconds: 30, ...options },
        },
        credentialId,
        position: [200, 0],
        ...extra,
      },
    ],
    edges: [{ id: 'e1', from: 'm', fromPort: 'main', to: 'ax', toPort: 'main' }],
    settings: {},
    pinData: { m: items.map((json) => ({ json })) },
  };
}

describe('spec 016 — HU-2: Agentix numa execução pela fila', () => {
  it('FR-008: "Testar" informa que a credencial é validada na primeira execução', async () => {
    const res = await editor.call('POST', `/credentials/${credentialId}/test`, {});
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('validada na primeira execução');
  });

  it('SC-003/FR-009/FR-010: cada item invoca uma sessão; com "continuar", o que falha vira item de erro', async () => {
    const wf = await createWorkflow(
      editor,
      project.id,
      workflow(
        [
          { entidade: 'conversor', pergunta: 'Capital?' },
          { entidade: 'falha', pergunta: 'Erro?' },
          { entidade: 'conversor', pergunta: 'De novo?' },
        ],
        { settings: { onError: 'continue' } },
      ),
    );
    const before = agentix.invokes.length;
    const detail = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(detail.status).toBe('success');
    const invokes = agentix.invokes.slice(before);
    expect(invokes.map((i) => [i.entity_name, i.payload])).toEqual([
      ['conversor', { pergunta: 'Capital?' }],
      ['falha', { pergunta: 'Erro?' }],
      ['conversor', { pergunta: 'De novo?' }],
    ]);
    const output = detail.nodes.find((n) => n.nodeId === 'ax')?.output?.main ?? [];
    expect(output.map((i) => i.json)).toEqual([
      expect.objectContaining({ state: 'DONE', output: 'A capital do Brasil é Brasília.' }),
      {
        error: expect.objectContaining({
          message: expect.stringContaining(
            'terminou com o estado FAILED: o agente quebrou',
          ) as unknown,
        }) as unknown,
      },
      expect.objectContaining({ state: 'DONE' }),
    ]);
  });

  it('FR-010: com "parar", a sessão que falha faz a execução falhar com o estado', async () => {
    const wf = await createWorkflow(
      editor,
      project.id,
      workflow([{ entidade: 'falha', pergunta: 'x' }]),
    );
    const detail = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toContain('FAILED: o agente quebrou');
  });

  it('FR-011: cancelar a execução interrompe a espera pela sessão', async () => {
    const wf = await createWorkflow(
      editor,
      project.id,
      workflow(
        [{ entidade: 'demorado', pergunta: 'x' }],
        {},
        { pollIntervalSeconds: 0.2, timeoutSeconds: 0 },
      ),
    );
    const polls = agentix.polls;
    const executionId = await startTestRun(editor, wf);
    await waitForStatus(editor, executionId, () => agentix.polls > polls + 1);
    const t0 = Date.now();
    expect((await editor.call('POST', `/executions/${executionId}/cancel`)).statusCode).toBe(202);
    const detail = await waitForStatus(editor, executionId);
    expect(detail.status).toBe('cancelled');
    expect(Date.now() - t0).toBeLessThan(3000);
    const after = agentix.polls;
    await new Promise((r) => setTimeout(r, 600));
    expect(agentix.polls).toBe(after);
  });

  it('FR-010: o tempo limite configurado no nó encerra a espera', async () => {
    const wf = await createWorkflow(
      editor,
      project.id,
      workflow([{ entidade: 'demorado', pergunta: 'x' }], {}, { timeoutSeconds: 0.5 }),
    );
    const detail = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toContain('último estado: RUNNING');
  });

  it('SC-004/FR-014: a chave do Agentix não aparece em logs, respostas ou no banco', async () => {
    const tables = await Promise.all(
      ['node_executions', 'executions', 'audit_log', 'credentials'].map(async (t) => {
        const { rows } = await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(t)}`.execute(
          ctx.database.db,
        );
        return JSON.stringify(rows, (_k, v: unknown) =>
          typeof v === 'object' && v !== null && (v as { type?: string }).type === 'Buffer'
            ? Buffer.from((v as { data: number[] }).data).toString('utf8')
            : v,
        );
      }),
    );
    expect(logs.join('').length).toBeGreaterThan(0);
    for (const [where, text] of Object.entries({
      logs: logs.join('\n'),
      responses: responses.join('\n'),
      db: tables.join('\n'),
    })) {
      expect(text.includes(agentix.apiKey), `${where} contém a chave`).toBe(false);
    }
  });
});
