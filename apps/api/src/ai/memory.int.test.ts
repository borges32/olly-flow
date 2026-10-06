import type { ProjectSummary, WorkflowNode } from '@olly/shared-types';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service.js';
import { REDIS } from '../core/tokens.js';
import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { agentWorkflow, allowModels, fakeModelCredential } from '../testing/ai.js';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

let ctx: TestContext;
let admin: TestUser, editor: TestUser;
let project: ProjectSummary, other: ProjectSummary;

beforeAll(async () => {
  ctx = await startTestContext({});
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@memory.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@memory.local' });
  project = (await admin.call('POST', '/projects', { name: 'Memória' })).json<ProjectSummary>();
  await allowModels(admin, ['fake-model', 'fake-model-2']);
  other = (await admin.call('POST', '/projects', { name: 'Outro' })).json<ProjectSummary>();
  for (const p of [project, other]) {
    await admin.call('PUT', `/projects/${p.id}/members/${editor.id}`, { role: 'editor' });
  }
});
afterAll(async () => {
  await ctx.close();
});

const memoryNode = (type: 'memory.postgres' | 'memory.buffer'): WorkflowNode => ({
  id: 'mem',
  type,
  name: 'Memória',
  params: { sessionKey: '={{ $json.sessionId }}', contextWindowLength: 10 },
  position: [400, 200],
});

/**
 * Roteiro de duas rodadas: sem histórico, o modelo anota; com histórico, conta as mensagens
 * que recebeu (sistema + histórico + pergunta) e repete a primeira pergunta lembrada.
 */
const script = [{ content: 'Anotado' }, { content: 'Mensagens: {{messageCount}}' }] as const;

async function ask(
  projectId: string,
  items: { sessionId: string; pergunta: string }[],
  type: 'memory.postgres' | 'memory.buffer' = 'memory.postgres',
): Promise<string[]> {
  const credentialId = await fakeModelCredential(editor, projectId, [...script]);
  const wf = await createWorkflow(
    editor,
    projectId,
    agentWorkflow({
      credentialId,
      memory: memoryNode(type),
      pinData: { m: items.map((json) => ({ json })) },
    }),
  );
  const done = await waitForStatus(editor, await startTestRun(editor, wf));
  expect(done.status).toBe('success');
  return (done.nodes.find((n) => n.nodeId === 'agent')?.output?.main ?? []).map((i) =>
    String(i.json.output),
  );
}

describe('spec 011 — SC-008/FR-009: memória do agente', () => {
  it('SC-008: a memória persistente lembra a conversa entre execuções, pela chave da sessão', async () => {
    expect(await ask(project.id, [{ sessionId: 'ana', pergunta: 'Meu nome é Ana' }])).toEqual([
      'Anotado',
    ]);
    // Outra execução, mesma sessão: o modelo recebe sistema + 2 do histórico + pergunta.
    expect(await ask(project.id, [{ sessionId: 'ana', pergunta: 'Qual é o meu nome?' }])).toEqual([
      'Mensagens: 4',
    ]);
    // Outra sessão e outro projeto (mesma chave) não enxergam a conversa.
    expect(await ask(project.id, [{ sessionId: 'bia', pergunta: 'Oi' }])).toEqual(['Anotado']);
    expect(await ask(other.id, [{ sessionId: 'ana', pergunta: 'Oi' }])).toEqual(['Anotado']);

    const rows = await ctx.database.db
      .selectFrom('agent_memory')
      .select(['session_key', 'message'])
      .where('project_id', '=', project.id)
      .where('session_key', '=', 'ana')
      .orderBy('id')
      .execute();
    expect(rows.map((r) => (r.message as { type: string }).type)).toEqual([
      'human',
      'ai',
      'human',
      'ai',
    ]);
  });

  it('FR-009: a janela limita as mensagens lembradas', async () => {
    for (let i = 0; i < 3; i++) {
      await ctx.database.db
        .insertInto('agent_memory')
        .values([
          {
            project_id: project.id,
            session_key: 'janela',
            message: JSON.stringify({ type: 'human', data: { content: `p${String(i)}` } }),
          },
          {
            project_id: project.id,
            session_key: 'janela',
            message: JSON.stringify({ type: 'ai', data: { content: `r${String(i)}` } }),
          },
        ])
        .execute();
    }
    const credentialId = await fakeModelCredential(editor, project.id, [
      { content: 'Mensagens: {{messageCount}}', repeat: true },
    ]);
    const node = memoryNode('memory.postgres');
    node.params = { ...node.params, contextWindowLength: 2 };
    const wf = await createWorkflow(
      editor,
      project.id,
      agentWorkflow({
        credentialId,
        memory: node,
        pinData: { m: [{ json: { sessionId: 'janela', pergunta: 'E agora?' } }] },
      }),
    );
    const done = await waitForStatus(editor, await startTestRun(editor, wf));
    // Sistema + 2 lembradas + pergunta.
    expect(done.nodes.find((n) => n.nodeId === 'agent')?.output?.main?.[0]?.json.output).toBe(
      'Mensagens: 4',
    );
  });

  it('FR-009: a memória temporária vale só dentro da execução', async () => {
    // Dois itens da mesma sessão na mesma execução: o segundo enxerga o primeiro.
    expect(
      await ask(
        project.id,
        [
          { sessionId: 'tmp', pergunta: 'Primeira' },
          { sessionId: 'tmp', pergunta: 'Segunda' },
        ],
        'memory.buffer',
      ),
    ).toEqual(['Anotado', 'Mensagens: 4']);
    // Nova execução começa sem histórico, e nada vai para o banco.
    expect(
      await ask(project.id, [{ sessionId: 'tmp', pergunta: 'Terceira' }], 'memory.buffer'),
    ).toEqual(['Anotado']);
    const stored = await ctx.database.db
      .selectFrom('agent_memory')
      .select('id')
      .where('session_key', '=', 'tmp')
      .execute();
    expect(stored).toEqual([]);
  });

  it('FR-009: a retenção apaga a memória mais antiga que o prazo do projeto', async () => {
    await admin.call('PUT', `/projects/${other.id}/settings`, { retention: { memoryDays: 7 } });
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    await ctx.database.db
      .insertInto('agent_memory')
      .values({
        project_id: other.id,
        session_key: 'antiga',
        message: JSON.stringify({ type: 'human', data: { content: 'velha' } }),
        created_at: old,
      })
      .execute();
    // O job roda no worker; aqui, direto.
    const report = await new MaintenanceService(
      ctx.database.db,
      ctx.app.get<Redis>(REDIS),
      ctx.config,
      new AuditService(),
      null,
    ).run();
    expect(report.memoryDeleted).toBeGreaterThanOrEqual(1);
    const left = await ctx.database.db
      .selectFrom('agent_memory')
      .select('session_key')
      .where('project_id', '=', other.id)
      .execute();
    expect(left.map((r) => r.session_key)).not.toContain('antiga');
    // A conversa recente (do primeiro teste) continua.
    expect(left.map((r) => r.session_key)).toContain('ana');
  });
});
