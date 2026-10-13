import { Writable } from 'node:stream';
import { startBridgeMock, type BridgeMock } from '@olly/nodes';
import type {
  AgentStep,
  AgentStepEvent,
  CredentialSummary,
  ExecutionDetail,
  ProjectSummary,
  WorkflowDefinition,
  WorkflowNode,
} from '@olly/shared-types';
import { sql } from 'kysely';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allowModels, fakeModelCredential } from '../testing/ai.js';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

/**
 * Spec 017 (T040, T050, T060): o Basic LLM Chain pela API e pela fila, com o modelo simulado
 * (spec 011) e a Bridge simulada (spec 016): uso e custo, limite mensal, modelo reserva e passos
 * mascarados no log e em tempo real.
 */
const CPF = '529.982.247-25';

let ctx: TestContext;
let admin: TestUser, editor: TestUser;
let project: ProjectSummary;
let bridge: BridgeMock;
let url: string;
const sockets: Socket[] = [];
const logs: string[] = [];

beforeAll(async () => {
  bridge = await startBridgeMock();
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
  url = await ctx.listen();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@chain.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@chain.local' });
  project = (await admin.call('POST', '/projects', { name: 'Chain' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  await allowModels(admin, ['fake-model', 'fake-model-2']);
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await ctx.close();
  await bridge.close();
});

const node = (n: Partial<WorkflowNode> & Pick<WorkflowNode, 'id' | 'type'>): WorkflowNode => ({
  name: n.id,
  params: {},
  position: [0, 0],
  ...n,
});

/** Manual (com o item fixado) → Basic LLM Chain, com o modelo e, se houver, o reserva. */
function chainWorkflow(input: {
  model: WorkflowNode;
  fallback?: WorkflowNode;
  chainParams?: Record<string, unknown>;
}): WorkflowDefinition {
  return {
    nodes: [
      node({ id: 'm', type: 'trigger.manual', name: 'Início' }),
      node({
        id: 'chain',
        type: 'ai.chainLlm',
        name: 'Chain',
        params: {
          promptSource: 'define',
          text: '=Resuma o chamado do cliente {{ $json.cpf }}',
          messages: [{ role: 'system', text: 'Responda em uma frase.' }],
          ...(input.fallback && { needsFallback: true }),
          ...input.chainParams,
        },
      }),
      { ...input.model, id: 'model' },
      ...(input.fallback ? [{ ...input.fallback, id: 'reserva', name: 'Reserva' }] : []),
    ],
    edges: [
      { id: 'e1', from: 'm', fromPort: 'main', to: 'chain', toPort: 'main' },
      {
        id: 'e2',
        from: 'model',
        fromPort: 'ai_languageModel',
        to: 'chain',
        toPort: 'ai_languageModel',
      },
      ...(input.fallback
        ? [
            {
              id: 'e3',
              from: 'reserva',
              fromPort: 'ai_languageModel',
              to: 'chain',
              toPort: 'ai_fallbackModel',
            },
          ]
        : []),
    ],
    settings: {},
    pinData: { m: [{ json: { cpf: CPF } }] },
  };
}

const fakeModel = async (script: Parameters<typeof fakeModelCredential>[2], model = 'fake-model') =>
  node({
    id: 'model',
    type: 'ai.chatModel',
    params: { model },
    credentialId: await fakeModelCredential(editor, project.id, script),
  });

async function run(definition: WorkflowDefinition, projectId = project.id) {
  const wf = await createWorkflow(editor, projectId, definition);
  const executionId = await startTestRun(editor, wf);
  return { wf, detail: await waitForStatus(editor, executionId) };
}

const chainOutput = (detail: ExecutionDetail) =>
  detail.nodes.find((n) => n.nodeId === 'chain')?.output?.main?.[0]?.json;

describe('spec 017 — Basic LLM Chain pela API', () => {
  it('SC-001/SC-007/FR-006/FR-012: texto em `text`, uso registrado e passos mascarados no log e em tempo real', async () => {
    const model = await fakeModel([
      { content: 'Chamado de {{lastHuman}}', usage: { input: 40, output: 8 } },
    ]);
    const definition = chainWorkflow({ model });
    const wf = await createWorkflow(editor, project.id, definition);
    const events: AgentStepEvent[] = [];
    const socket = io(`${url}/executions`, {
      auth: { token: editor.token },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    socket.on('agentStep', (e: AgentStepEvent) => events.push(e));
    expect(await socket.emitWithAck('joinWorkflow', { workflowId: wf.id })).toEqual({ ok: true });

    const executionId = await startTestRun(editor, wf);
    const detail = await waitForStatus(editor, executionId);
    expect(detail.status).toBe('success');
    // O texto vai em `text` (FR-004); os dados do nó já passam pelo mascaramento do projeto.
    expect(chainOutput(detail)).toEqual({ text: expect.stringContaining('Chamado de') as unknown });

    const steps = (await editor.call('GET', `/executions/${executionId}/agent-steps`)).json<
      AgentStep[]
    >();
    expect(steps.map((s) => [s.nodeId, s.kind])).toEqual([
      ['chain', 'model'],
      ['chain', 'final'],
    ]);
    expect(steps[0]).toMatchObject({ inputTokens: 40, outputTokens: 8 });
    expect(steps[0]?.content).toMatchObject({
      model: 'fake-model',
      fallback: false,
      messages: [
        { role: 'system', text: 'Responda em uma frase.' },
        { role: 'user', text: expect.stringContaining('Resuma o chamado') as unknown },
      ],
    });
    // Spec 009: o CPF do prompt fica mascarado nos passos gravados e transmitidos.
    expect(JSON.stringify(steps)).not.toContain(CPF);
    expect(JSON.stringify(steps)).toContain('***.***.247-**');
    await expect.poll(() => events.length).toBe(2);
    expect(JSON.stringify(events)).not.toContain(CPF);

    const usage = await ctx.database.db
      .selectFrom('llm_usage')
      .select(['provider', 'model', 'input_tokens', 'output_tokens', 'node_id'])
      .where('execution_id', '=', executionId)
      .execute();
    expect(usage).toEqual([
      {
        provider: 'fake',
        model: 'fake-model',
        input_tokens: 40,
        output_tokens: 8,
        node_id: 'chain',
      },
    ]);
  });

  it('SC-002/FR-005: JSON Schema: objeto em `output`, com correção', async () => {
    const model = await fakeModel([
      { content: 'acho que é rede' },
      { content: '{"categoria": "rede"}' },
    ]);
    const { detail } = await run(
      chainWorkflow({
        model,
        chainParams: {
          outputParser: 'jsonSchema',
          schema:
            '{"type":"object","required":["categoria"],"properties":{"categoria":{"type":"string"}}}',
        },
      }),
    );
    expect(detail.status).toBe('success');
    expect(chainOutput(detail)).toEqual({ output: { categoria: 'rede' } });
  });

  it('SC-003/FR-006: o limite mensal do projeto bloqueia novas chamadas', async () => {
    const limited = (
      await admin.call('POST', '/projects', { name: 'Chain limitada' })
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
    const model = node({
      id: 'model',
      type: 'ai.chatModel',
      params: { model: 'fake-model' },
      credentialId: await fakeModelCredential(editor, limited.id, [
        { content: 'ok', repeat: true },
      ]),
    });
    expect((await run(chainWorkflow({ model }), limited.id)).detail.status).toBe('success');
    const blocked = (await run(chainWorkflow({ model }), limited.id)).detail;
    expect(blocked.status).toBe('error');
    expect(blocked.error?.message).toContain('Limite mensal de tokens do projeto atingido');
  });

  it('SC-006/FR-011: o principal falha e a resposta vem do reserva; uso e passos citam o reserva', async () => {
    // Roteiro vazio: o modelo principal falha na chamada.
    const principal = await fakeModel([], 'fake-model');
    const reserva = await fakeModel([{ content: 'resposta do reserva' }], 'fake-model-2');
    const { detail } = await run(chainWorkflow({ model: principal, fallback: reserva }));
    expect(detail.error?.message ?? '').toBe('');
    expect(detail.status).toBe('success');
    expect(chainOutput(detail)).toEqual({ text: 'resposta do reserva' });
    const usage = await ctx.database.db
      .selectFrom('llm_usage')
      .select('model')
      .where('execution_id', '=', detail.id)
      .execute();
    expect(usage.map((u) => u.model)).toEqual(['fake-model-2']);
    const steps = (await editor.call('GET', `/executions/${detail.id}/agent-steps`)).json<
      AgentStep[]
    >();
    expect(steps.map((s) => s.kind)).toEqual(['error', 'model', 'final']);
    expect(steps[1]?.content).toMatchObject({ model: 'fake-model-2', fallback: true });
  });

  it('SC-004/FR-010: funciona com o Bridge Chat Model; senha e token fora dos passos, dados e logs', async () => {
    const cred = await editor.call('POST', `/projects/${project.id}/credentials`, {
      name: 'Bridge',
      type: 'bridgeApi',
      data: {
        tokenUrl: bridge.tokenUrl,
        baseUrl: bridge.baseUrl,
        identificador: bridge.identificador,
        senha: bridge.senha,
      },
    });
    const model = node({
      id: 'model',
      type: 'ai.bridgeChatModel',
      params: { model: 'gemini-2.5-flash', stream: false },
      credentialId: cred.json<CredentialSummary>().id,
    });
    const { detail } = await run(chainWorkflow({ model }));
    expect(detail.status).toBe('success');
    // A resposta da Bridge vem em blocos (images: []): a saída é o texto.
    expect(chainOutput(detail)).toEqual({ text: 'ok' });
    expect(bridge.calls.at(-1)?.body.messages).toEqual([
      { role: 'system', content: 'Responda em uma frase.' },
      { role: 'user', content: expect.stringContaining('Resuma o chamado') as unknown },
    ]);
    const tables = await Promise.all(
      ['node_executions', 'agent_steps', 'executions'].map(async (t) => {
        const { rows } = await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(t)}`.execute(
          ctx.database.db,
        );
        return JSON.stringify(rows);
      }),
    );
    for (const secret of [bridge.senha, ...bridge.tokens]) {
      expect(tables.join('\n').includes(secret)).toBe(false);
      expect(logs.join('\n').includes(secret)).toBe(false);
    }
  });
});
