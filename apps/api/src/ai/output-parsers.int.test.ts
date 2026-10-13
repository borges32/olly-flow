import type {
  AgentStep,
  ExecutionDetail,
  ProjectSummary,
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowNode,
} from '@olly/shared-types';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allowModels, fakeModelCredential } from '../testing/ai.js';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

/**
 * Spec 018 (T050): output parsers pela API e pela fila, com o modelo simulado: Structured (com e
 * sem correção automática), Auto-fixing com o próprio modelo, Item List e a migração dos
 * workflows salvos com o JSON Schema dentro do nó.
 */
let ctx: TestContext;
let admin: TestUser, editor: TestUser;
let project: ProjectSummary;

beforeAll(async () => {
  ctx = await startTestContext({});
  admin = await loginAs(ctx, { sub: 'admin', email: 'admin@parsers.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@parsers.local' });
  project = (await admin.call('POST', '/projects', { name: 'Parsers' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
  await allowModels(admin, ['fake-model', 'fake-model-2']);
});
afterAll(async () => {
  await ctx.close();
});

const SCHEMA = '{"type":"object","required":["nota"],"properties":{"nota":{"type":"number"}}}';

const node = (n: Partial<WorkflowNode> & Pick<WorkflowNode, 'id' | 'type'>): WorkflowNode => ({
  name: n.id,
  params: {},
  position: [0, 0],
  ...n,
});
const edge = (from: string, to: string, kind: string) => ({
  id: `${from}-${to}-${kind}`,
  from,
  fromPort: kind,
  to,
  toPort: kind,
});

async function model(id: string, script: unknown[], name = 'fake-model'): Promise<WorkflowNode> {
  return node({
    id,
    type: 'ai.chatModel',
    params: { model: name },
    credentialId: await fakeModelCredential(editor, project.id, script as never),
  });
}

/** Manual → raiz (Agent ou Basic LLM Chain) com modelo, opção ligada e os sub-nós dados. */
function definition(
  root: 'ai.agent' | 'ai.chainLlm',
  rootModel: WorkflowNode,
  extra: WorkflowNode[],
  edges: ReturnType<typeof edge>[],
  rootParams: Record<string, unknown> = { hasOutputParser: true },
): WorkflowDefinition {
  return {
    nodes: [
      node({ id: 'm', type: 'trigger.manual' }),
      node({
        id: 'root',
        type: root,
        params: { promptSource: 'define', text: 'Avalie', ...rootParams },
      }),
      rootModel,
      ...extra,
    ],
    edges: [
      { id: 'e', from: 'm', fromPort: 'main', to: 'root', toPort: 'main' },
      edge(rootModel.id, 'root', 'ai_languageModel'),
      ...edges,
    ],
    settings: {},
  };
}

async function run(def: WorkflowDefinition): Promise<ExecutionDetail> {
  const wf = await createWorkflow(editor, project.id, def);
  return waitForStatus(editor, await startTestRun(editor, wf));
}

const rootOutput = (detail: ExecutionDetail) =>
  detail.nodes.find((n) => n.nodeId === 'root')?.output?.main?.[0]?.json;

describe('spec 018 — output parsers pela API', () => {
  it('SC-001/FR-002/FR-003: Agent com Structured (autoFix) corrige com o modelo do nó; sem autoFix, falha', async () => {
    const rootModel = await model('modelo', [{ content: 'nota sete' }, { content: '{"nota": 7}' }]);
    const parser = node({
      id: 'formato',
      type: 'outputParser.structured',
      params: { schemaType: 'manual', inputSchema: SCHEMA, autoFix: true },
    });
    const ok = await run(
      definition('ai.agent', rootModel, [parser], [edge('formato', 'root', 'ai_outputParser')]),
    );
    expect(ok.status).toBe('success');
    expect(rootOutput(ok)).toMatchObject({ output: { nota: 7 } });

    const strictModel = await model('modelo', [{ content: 'nota sete', repeat: true }]);
    const strict = await run(
      definition(
        'ai.agent',
        strictModel,
        [{ ...parser, params: { ...parser.params, autoFix: false } }],
        [edge('formato', 'root', 'ai_outputParser')],
      ),
    );
    expect(strict.status).toBe('error');
    expect(strict.error?.message).toContain('não segue o formato do output parser');
  });

  it('SC-002/FR-004/FR-007: Auto-fixing corrige com o próprio modelo; uso e passos com esse modelo', async () => {
    const rootModel = await model('modelo', [{ content: 'nota oito' }]);
    const fixerModel = await model('corretor', [{ content: '{"nota": 8}' }], 'fake-model-2');
    const def = definition(
      'ai.chainLlm',
      rootModel,
      [
        node({ id: 'fixer', type: 'outputParser.autoFixing' }),
        fixerModel,
        node({
          id: 'formato',
          type: 'outputParser.structured',
          params: { schemaType: 'manual', inputSchema: SCHEMA },
        }),
      ],
      [
        edge('fixer', 'root', 'ai_outputParser'),
        edge('corretor', 'fixer', 'ai_languageModel'),
        edge('formato', 'fixer', 'ai_outputParser'),
      ],
    );
    const detail = await run(def);
    expect(detail.status).toBe('success');
    expect(rootOutput(detail)).toEqual({ output: { nota: 8 } });
    const usage = await ctx.database.db
      .selectFrom('llm_usage')
      .select('model')
      .where('execution_id', '=', detail.id)
      .execute();
    expect(usage.map((u) => u.model)).toEqual(['fake-model', 'fake-model-2']);
    const steps = (await editor.call('GET', `/executions/${detail.id}/agent-steps`)).json<
      AgentStep[]
    >();
    expect(steps.map((s) => s.kind)).toEqual(['model', 'model', 'final']);
    expect(steps[1]?.content).toMatchObject({ model: 'fake-model-2', fixer: true });
  });

  it('SC-003/FR-005: Item List devolve a lista com o limite', async () => {
    const rootModel = await model('modelo', [{ content: '1. Azul\n2. Verde\n3. Roxo' }]);
    const detail = await run(
      definition(
        'ai.chainLlm',
        rootModel,
        [
          node({
            id: 'lista',
            type: 'outputParser.itemList',
            params: { options: { numberOfItems: 2 } },
          }),
        ],
        [edge('lista', 'root', 'ai_outputParser')],
      ),
    );
    expect(rootOutput(detail)).toEqual({ output: ['Azul', 'Verde'] });
  });

  it('SC-004/FR-006: workflow salvo no formato antigo é migrado na leitura, na entrada e na execução, com a mesma saída', async () => {
    const rootModel = await model('modelo', [{ content: 'sem json' }, { content: '{"nota": 9}' }]);
    const legacy = definition('ai.chainLlm', rootModel, [], [], {
      outputParser: 'jsonSchema',
      schema: SCHEMA,
    });
    // Entrada da API: o salvamento já migra.
    const created = await createWorkflow(editor, project.id, legacy);
    expect(created.definition.nodes.map((n) => n.type)).toContain('outputParser.structured');

    // Versão gravada no formato antigo (como antes da spec 018): a leitura migra.
    await sql`UPDATE workflow_versions SET definition = ${JSON.stringify(legacy)}
      WHERE workflow_id = ${created.id}`.execute(ctx.database.db);
    const read = (await editor.call('GET', `/workflows/${created.id}`)).json<WorkflowDetail>();
    const root = read.definition.nodes.find((n) => n.id === 'root');
    expect(root?.params).toMatchObject({ hasOutputParser: true });
    expect(root?.params).not.toHaveProperty('outputParser');
    expect(read.definition.nodes.find((n) => n.id === 'root-parser')).toMatchObject({
      type: 'outputParser.structured',
      params: { schemaType: 'manual', inputSchema: SCHEMA, autoFix: true },
    });

    // Execução e publicação a partir do salvo (antigo no banco): mesma saída e correção de antes.
    const detail = await waitForStatus(editor, await startTestRun(editor, read));
    expect(detail.status).toBe('success');
    expect(rootOutput(detail)).toEqual({ output: { nota: 9 } });
    const published = await editor.call('POST', `/workflows/${created.id}/publish`, {
      message: 'Formato antigo',
    });
    expect(published.statusCode).toBe(200);
  });
});
