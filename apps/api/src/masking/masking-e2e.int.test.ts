import { Writable } from 'node:stream';
import { Logger } from '@nestjs/common';
import type {
  MaskingRule,
  NodeFinishedEvent,
  ProjectSummary,
  WorkflowDefinition,
} from '@olly/shared-types';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

const CPF = '529.982.247-25';
const SECRET = 'senha-sentinela-123';

let ctx: TestContext;
let url: string;
let admin: TestUser, editor: TestUser, executor: TestUser;
let project: ProjectSummary;
let other: ProjectSummary;
const logs: string[] = [];
const sockets: Socket[] = [];

/**
 * O nó "Usa" lê o CPF e a senha que recebeu: se o próximo nó recebesse os dados mascarados,
 * `docIgual` seria `false`. O nó "Falha" lança um erro com o CPF na mensagem.
 */
const definition: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'u',
      type: 'data.set',
      name: 'Usa',
      params: {
        fields: [
          { name: 'copia', type: 'string', value: '={{ $json.cpf }}' },
          { name: 'docIgual', type: 'boolean', value: `={{ $json.cpf === '${CPF}' }}` },
          { name: 'chaveIgual', type: 'boolean', value: `={{ $json.senha === '${SECRET}' }}` },
          {
            name: 'obs',
            type: 'string',
            value: '=Cliente {{ $json.nome }} de CPF {{ $json.cpf }}',
          },
        ],
        includeOtherFields: true,
      },
      position: [200, 0],
    },
    {
      id: 'c',
      type: 'code.javascript',
      name: 'Confere',
      params: {
        mode: 'runOnceForAllItems',
        jsCode:
          "const i = $input.first().json; console.log('cpf recebido', i.cpf); return [{ json: { ok: i.docIgual && i.chaveIgual && i.cpf === '" +
          CPF +
          "' } }];",
      },
      position: [400, 0],
    },
  ],
  edges: [
    { id: 'a', from: 'm', fromPort: 'main', to: 'u', toPort: 'main' },
    { id: 'b', from: 'u', fromPort: 'main', to: 'c', toPort: 'main' },
  ],
  settings: {},
  pinData: { m: [{ json: { nome: 'Maria', cpf: CPF, senha: SECRET } }] },
};

function connect(token: string): Promise<Socket> {
  const socket = io(`${url}/executions`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('connect_error', reject);
  });
}

beforeAll(async () => {
  const logStream = new Writable({
    write(chunk: Buffer, _enc, done) {
      logs.push(chunk.toString('utf8'));
      done();
    },
  });
  ctx = await startTestContext({ logLevel: 'trace' }, { logStream });
  url = await ctx.listen();
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@t.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@t.local' });
  executor = await loginAs(ctx, { sub: 'executor', email: 'executor@t.local' });
  project = (await admin.call('POST', '/projects', { name: 'LGPD' })).json<ProjectSummary>();
  other = (await admin.call('POST', '/projects', { name: 'Outro' })).json<ProjectSummary>();
  for (const p of [project, other]) {
    await admin.call('PUT', `/projects/${p.id}/members/${editor.id}`, { role: 'editor' });
  }
  await admin.call('PUT', `/projects/${project.id}/members/${executor.id}`, { role: 'executor' });
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await ctx.close();
});

describe('spec 009 — FR-014/FR-015/SC-003: mascaramento no banco, no WebSocket e nos logs', () => {
  it('FR-014/FR-015/SC-003: CPF e senha mascarados ao gravar e transmitir; os nós recebem o original', async () => {
    const wf = await createWorkflow(editor, project.id, definition);
    const socket = await connect(editor.token);
    const events: NodeFinishedEvent[] = [];
    socket.on('nodeFinished', (e: NodeFinishedEvent) => events.push(e));
    expect(await socket.emitWithAck('joinWorkflow', { workflowId: wf.id })).toEqual({ ok: true });

    const executionId = await startTestRun(editor, wf);
    const detail = await waitForStatus(editor, executionId);
    expect(detail.status).toBe('success');

    // FR-015: os nós seguintes receberam os valores reais.
    const confere = detail.nodes.find((n) => n.nodeId === 'c');
    expect(confere?.output?.main?.[0]?.json).toEqual({ ok: true });
    const usa = detail.nodes.find((n) => n.nodeId === 'u');
    expect(usa?.output?.main?.[0]?.json).toMatchObject({
      docIgual: true,
      chaveIgual: true,
      copia: '***.***.247-**',
      cpf: '***.***.247-**',
      senha: '***',
      obs: 'Cliente Maria de CPF ***.***.247-**',
    });
    // Console do nó de código também mascarado.
    expect(confere?.console?.join(' ')).toContain('***.***.247-**');

    // Banco: nenhuma coluna guarda o CPF ou a senha.
    const rows = await ctx.database.db
      .selectFrom('node_executions')
      .selectAll()
      .where('execution_id', '=', executionId)
      .execute();
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(CPF);
    expect(stored).not.toContain('52998224725');
    expect(stored).not.toContain(SECRET);
    expect(rows.find((r) => r.node_id === 'u')?.data_masked).toBe(true);

    // WebSocket.
    await expect.poll(() => events.filter((e) => e.executionId === executionId).length).toBe(3);
    const transmitted = JSON.stringify(events);
    expect(transmitted).toContain('***.***.247-**');
    expect(transmitted).not.toContain(CPF);
    expect(transmitted).not.toContain(SECRET);
  });

  it('FR-014/SC-003: mensagens de erro e logs também são mascarados', async () => {
    const failing: WorkflowDefinition = {
      ...definition,
      nodes: [
        definition.nodes[0] as WorkflowDefinition['nodes'][number],
        {
          id: 'f',
          type: 'code.javascript',
          name: 'Falha',
          params: {
            mode: 'runOnceForAllItems',
            jsCode: "throw new Error('CPF inválido: ' + $input.first().json.cpf);",
          },
          position: [200, 0],
        },
      ],
      edges: [{ id: 'a', from: 'm', fromPort: 'main', to: 'f', toPort: 'main' }],
    };
    const wf = await createWorkflow(editor, project.id, failing);
    const detail = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(detail.status).toBe('error');
    expect(JSON.stringify(detail.error)).not.toContain(CPF);
    expect(JSON.stringify(detail.nodes)).toContain('***.***.247-**');

    // Logs da aplicação (objeto e mensagem).
    const logger = new Logger('TesteLGPD');
    logger.warn(`cliente com CPF ${CPF}`);
    logger.log({ msg: 'objeto', usuario: { senha: SECRET, cpf: CPF } });
    await expect.poll(() => logs.join('').includes('TesteLGPD')).toBe(true);
    const all = logs.join('');
    expect(all).not.toContain(CPF);
    expect(all).not.toContain(SECRET);
    expect(all).toContain('***.***.247-**');
  });
});

describe('spec 009 — FR-016: regras padrão, globais e por projeto', () => {
  it('FR-016: regras padrão (CPF, CNPJ, senha, token, authorization, cartão) vêm ativas e não podem ser excluídas', async () => {
    const rules = (await admin.call('GET', '/masking-rules')).json<MaskingRule[]>();
    const active = rules.filter((r) => r.builtin && r.enabled).map((r) => r.matcher);
    expect(active).toEqual(
      expect.arrayContaining([
        'cpf',
        'cnpj',
        'card',
        '*password*',
        '*senha*',
        '*token*',
        '*authorization*',
      ]),
    );
    const cpf = rules.find((r) => r.builtin && r.matcher === 'cpf');
    expect((await admin.call('DELETE', `/masking-rules/${cpf?.id}`)).statusCode).toBe(409);
    expect(
      (
        await admin.call('PUT', `/masking-rules/${cpf?.id}`, {
          kind: 'pattern',
          matcher: 'cnpj',
          action: 'redact',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await admin.call('POST', '/masking-rules', {
          kind: 'pattern',
          matcher: 'rg',
          action: 'redact',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('FR-016: regra do projeto vale só no projeto; mudanças auditadas', async () => {
    const created = await admin.call('POST', `/projects/${project.id}/masking-rules`, {
      kind: 'field',
      matcher: 'nome',
      action: 'hash',
      description: 'Nome do cliente',
    });
    expect(created.statusCode).toBe(201);
    const rule = created.json<MaskingRule>();
    expect(rule).toMatchObject({ scope: 'project', projectId: project.id });
    // A mudança chega aos workers pelo Redis.
    await new Promise((r) => setTimeout(r, 200));

    const run = async (projectId: string) => {
      const wf = await createWorkflow(editor, projectId, definition);
      const detail = await waitForStatus(editor, await startTestRun(editor, wf));
      return detail.nodes.find((n) => n.nodeId === 'u')?.output?.main?.[0]?.json;
    };
    const masked = await run(project.id);
    expect(masked?.nome).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((await run(other.id))?.nome).toBe('Maria');

    // Executor não administra regras do projeto.
    expect((await executor.call('GET', `/projects/${project.id}/masking-rules`)).statusCode).toBe(
      403,
    );
    expect(
      (await admin.call('DELETE', `/projects/${project.id}/masking-rules/${rule.id}`)).statusCode,
    ).toBe(204);
    const audit = await ctx.database.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', rule.id)
      .orderBy('id')
      .execute();
    expect(audit.map((a) => a.action)).toEqual(['masking_rule.create', 'masking_rule.delete']);
  });

  it('FR-015: execução parcial de teste reaproveita os dados como gravados e avisa os campos mascarados', async () => {
    const wf = await createWorkflow(editor, project.id, definition);
    const first = await startTestRun(editor, wf);
    await waitForStatus(editor, first);
    const res = await editor.call('POST', `/workflows/${wf.id}/test-run`, {
      definition,
      destinationNodeId: 'c',
      reuse: { u: first },
    });
    const detail = await waitForStatus(editor, res.json<{ executionId: string }>().executionId);
    const usa = detail.nodes.find((n) => n.nodeId === 'u');
    // O nó reaproveitado entrega o que foi gravado: os campos mascarados chegam mascarados.
    expect(usa?.reused).toBe(true);
    expect(usa?.maskedFields).toEqual(expect.arrayContaining(['cpf', 'senha', 'copia', 'obs']));
    expect(detail.nodes.find((n) => n.nodeId === 'c')?.output?.main?.[0]?.json).toEqual({
      ok: false,
    });
    // Sem reaproveitamento, nada a avisar.
    expect(detail.nodes.find((n) => n.nodeId === 'c')?.maskedFields).toBeUndefined();
  });
});
