import { Writable } from 'node:stream';
import { startBridgeMock, type BridgeMock } from '@olly/nodes';
import type {
  CredentialSummary,
  CredentialTestResponse,
  ExecutionDetail,
  ProjectSummary,
  WorkflowDefinition,
  WorkflowNode,
} from '@olly/shared-types';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

/**
 * Spec 016, HU-1 (T023): Agent com o Bridge Chat Model pela API e pela fila, contra a Bridge
 * simulada (NFR-003). A instalação não tem nenhum modelo liberado: a Bridge não usa a lista
 * (FR-006).
 */
let ctx: TestContext;
let admin: TestUser, editor: TestUser;
let project: ProjectSummary;
let bridge: BridgeMock;
let credentialId: string;
const logs: string[] = [];
const responses: string[] = [];

beforeAll(async () => {
  // Token de ~64 s com margem de 60 s: renovado a cada ~4 s (SC-002).
  bridge = await startBridgeMock({ tokenTtlSeconds: 64 });
  const logStream = new Writable({
    write(chunk: Buffer, _enc, done) {
      logs.push(chunk.toString('utf8'));
      done();
    },
  });
  ctx = await startTestContext(
    // O serviço simulado fica em 127.0.0.1 (loopback continua exigindo a allowlist, FR-013).
    { logLevel: 'trace', http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 } },
    { logStream },
  );
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@bridge.local', groups: ['admin'] });
  const plain = await loginAs(ctx, { sub: 'editor', email: 'editor@bridge.local' });
  editor = {
    ...plain,
    call: async (method, path, payload) => {
      const res = await plain.call(method, path, payload);
      responses.push(res.body);
      return res;
    },
  };
  project = (await admin.call('POST', '/projects', { name: 'Bridge' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  const created = await editor.call('POST', `/projects/${project.id}/credentials`, {
    name: 'Bridge homologação',
    type: 'bridgeApi',
    data: {
      tokenUrl: bridge.tokenUrl,
      baseUrl: bridge.baseUrl,
      identificador: bridge.identificador,
      senha: bridge.senha,
    },
  });
  expect(created.statusCode).toBe(201);
  credentialId = created.json<CredentialSummary>().id;
});
afterAll(async () => {
  await ctx.close();
  await bridge.close();
});

const node = (n: Partial<WorkflowNode> & Pick<WorkflowNode, 'id' | 'type'>): WorkflowNode => ({
  name: n.id,
  params: {},
  position: [0, 0],
  ...n,
});

/** Manual → Agent, com o Bridge Chat Model e a ferramenta "somar". */
function workflow(modelParams: Record<string, unknown> = {}): WorkflowDefinition {
  return {
    nodes: [
      node({ id: 'm', type: 'trigger.manual', name: 'Início' }),
      node({
        id: 'agent',
        type: 'ai.agent',
        name: 'Agente',
        params: { promptSource: 'define', text: '={{ $json.pergunta }}' },
      }),
      node({
        id: 'model',
        type: 'ai.bridgeChatModel',
        name: 'Bridge',
        params: { model: 'gemini-2.5-flash', ...modelParams },
        credentialId,
      }),
      node({
        id: 'tool',
        type: 'tool.code',
        name: 'Somar',
        params: {
          toolName: 'somar',
          toolDescription: 'Soma dois números',
          inputSchema:
            '{"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}}}',
          jsCode: 'const { a, b } = $input.first().json; return { soma: a + b };',
        },
      }),
    ],
    edges: [
      { id: 'e1', from: 'm', fromPort: 'main', to: 'agent', toPort: 'main' },
      {
        id: 'e2',
        from: 'model',
        fromPort: 'ai_languageModel',
        to: 'agent',
        toPort: 'ai_languageModel',
      },
      { id: 'e3', from: 'tool', fromPort: 'ai_tool', to: 'agent', toPort: 'ai_tool' },
    ],
    settings: {},
    pinData: { m: [{ json: { pergunta: 'Quanto é 2 + 3?' } }] },
  };
}

async function run(definition: WorkflowDefinition): Promise<ExecutionDetail> {
  const wf = await createWorkflow(editor, project.id, definition);
  return waitForStatus(editor, await startTestRun(editor, wf), undefined, 30_000);
}

describe('spec 016 — HU-1: Agent com o Bridge Chat Model (API e fila)', () => {
  it('FR-002: "Testar" a credencial faz o login de serviço', async () => {
    const before = bridge.logins;
    const res = await editor.call('POST', `/credentials/${credentialId}/test`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json<CredentialTestResponse>()).toEqual({ ok: true, message: 'Login bem-sucedido' });
    expect(bridge.logins).toBe(before + 1);
  });

  it('SC-001/FR-001/FR-003/FR-006: conversa com ferramenta, streaming e uso registrado, sem lista de modelos', async () => {
    const mock = await startBridgeMock({
      tokenTtlSeconds: 1200,
      script: [
        { toolCalls: [{ name: 'somar', args: { a: 2, b: 3 } }] },
        { content: 'A soma é 5.' },
      ],
    });
    try {
      const updated = await editor.call('PUT', `/credentials/${credentialId}`, {
        data: { tokenUrl: mock.tokenUrl, baseUrl: mock.baseUrl },
      });
      expect(updated.statusCode).toBe(200);
      const detail = await run(workflow({ stream: true, options: { streamUsage: true } }));
      expect(detail.status).toBe('success');
      const agent = detail.nodes.find((n) => n.nodeId === 'agent');
      expect(agent?.output?.main?.[0]?.json).toMatchObject({ output: 'A soma é 5.' });
      // Endereço com o modelo, token Bearer, sem "model" no corpo, streaming e uso pedido.
      expect(mock.calls).toHaveLength(2);
      for (const call of mock.calls) {
        expect(call.model).toBe('gemini-2.5-flash');
        expect(call.authorization).toBe(`Bearer ${mock.tokens[0] ?? ''}`);
        expect(call.body).not.toHaveProperty('model');
        expect(call.body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
      }
      expect(mock.calls[0]?.body.tools).toEqual([
        expect.objectContaining({
          function: expect.objectContaining({ name: 'somar' }) as unknown,
        }),
      ]);
      expect(mock.logins).toBe(1);
      // FR-006: uso registrado com o provedor "bridge" e o modelo informado; o custo usa o preço
      // cadastrado para o nome do modelo (o gemini-2.5-flash vem na tabela semeada).
      const usage = await ctx.database.db
        .selectFrom('llm_usage')
        .select(['provider', 'model', 'input_tokens', 'output_tokens', 'cost_estimate'])
        .where('execution_id', '=', detail.id)
        .execute();
      expect(usage).toHaveLength(2);
      for (const row of usage) {
        expect(row).toMatchObject({
          provider: 'bridge',
          model: 'gemini-2.5-flash',
          input_tokens: 12,
          output_tokens: 7,
        });
        expect(Number(row.cost_estimate)).toBeGreaterThan(0);
      }
      // Passos do agente: modelo, ferramenta, modelo e resposta final.
      const steps = await ctx.database.db
        .selectFrom('agent_steps')
        .select(['kind', 'tool_name'])
        .where('execution_id', '=', detail.id)
        .orderBy('step_index')
        .execute();
      expect(steps.map((s) => s.kind)).toContain('tool');
    } finally {
      await editor.call('PUT', `/credentials/${credentialId}`, {
        data: { tokenUrl: bridge.tokenUrl, baseUrl: bridge.baseUrl },
      });
      await mock.close();
    }
  });

  it('FR-006: o limite mensal de tokens do projeto vale para a Bridge', async () => {
    const limited = (
      await admin.call('POST', '/projects', { name: 'Bridge limitada' })
    ).json<ProjectSummary>();
    await admin.call('PUT', `/projects/${limited.id}/members/${editor.id}`, { role: 'editor' });
    expect(
      (
        await admin.call('PUT', `/projects/${limited.id}/ai-settings`, {
          allowedModels: null,
          monthlyTokenLimit: 1,
        })
      ).statusCode,
    ).toBe(200);
    const cred = await editor.call('POST', `/projects/${limited.id}/credentials`, {
      name: 'Bridge',
      type: 'bridgeApi',
      data: {
        tokenUrl: bridge.tokenUrl,
        baseUrl: bridge.baseUrl,
        identificador: bridge.identificador,
        senha: bridge.senha,
      },
    });
    // Sem streaming, a Bridge devolve o uso de tokens (com streaming, só com "pedir o uso").
    const definition = workflow({ stream: false });
    const model = definition.nodes.find((n) => n.id === 'model');
    if (model) model.credentialId = cred.json<CredentialSummary>().id;
    const wf = await createWorkflow(editor, limited.id, definition);
    // A primeira execução usa 19 tokens (12 + 7) e passa do limite de 1.
    const first = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(first.status).toBe('success');
    const calls = bridge.calls.length;
    const detail = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(detail.status).toBe('error');
    expect(detail.error?.message).toContain('Limite mensal de tokens do projeto atingido');
    expect(bridge.calls.length).toBe(calls);
  });

  it('SC-002/FR-004/FR-005: execuções atravessam a expiração do token e um 401, com um login por ciclo', async () => {
    const start = bridge.logins;
    const first = await run(workflow({ stream: false }));
    expect(first.status).toBe('success');
    expect(bridge.logins).toBe(start + 1);
    // O token vence (exp − margem) e é renovado antes da chamada, sem 401.
    await new Promise((r) => setTimeout(r, 4500));
    const callsBefore = bridge.calls.length;
    const second = await run(workflow({ stream: false }));
    expect(second.status).toBe('success');
    expect(bridge.logins).toBe(start + 2);
    expect(bridge.calls.length - callsBefore).toBe(1);
    // O servidor recusa o token (401): novo login e a chamada é repetida uma vez.
    bridge.expireTokens();
    const third = await run(workflow({ stream: false }));
    expect(third.status).toBe('success');
    expect(bridge.logins).toBe(start + 3);
    const lastCalls = bridge.calls.slice(-2);
    expect(lastCalls[0]?.authorization).not.toBe(lastCalls[1]?.authorization);
  });

  it('SC-004/FR-014: senha e tokens não aparecem em logs, respostas ou no banco', async () => {
    const sentinels = [bridge.senha, ...bridge.tokens];
    expect(bridge.tokens.length).toBeGreaterThan(0);
    const tables = await Promise.all(
      ['node_executions', 'executions', 'audit_log', 'agent_steps', 'llm_usage', 'credentials'].map(
        async (t) => {
          const { rows } = await sql<
            Record<string, unknown>
          >`SELECT * FROM ${sql.table(t)}`.execute(ctx.database.db);
          return JSON.stringify(rows, (_k, v: unknown) =>
            typeof v === 'object' && v !== null && (v as { type?: string }).type === 'Buffer'
              ? Buffer.from((v as { data: number[] }).data).toString('utf8')
              : v,
          );
        },
      ),
    );
    const haystacks = {
      logs: logs.join('\n'),
      responses: responses.join('\n'),
      db: tables.join('\n'),
    };
    expect(haystacks.logs.length).toBeGreaterThan(0);
    for (const [where, text] of Object.entries(haystacks)) {
      for (const secret of sentinels) {
        expect(text.includes(secret), `${where} contém um segredo`).toBe(false);
      }
    }
  });
});
