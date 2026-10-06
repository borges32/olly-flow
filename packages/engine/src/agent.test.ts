import { IsolateEvaluator } from '@olly/expressions/isolate';
import {
  builtinNodes,
  createNodeRegistry,
  type AgentStepInput,
  type AgentTool,
  type AiGateway,
  type AiUsageInput,
  type FakeModelStep,
  type NodeDefinition,
} from '@olly/nodes';
import type { Edge, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { afterAll, describe, expect, it } from 'vitest';
import { runWorkflow, type EngineSnapshot, type NodeRunRecord } from './run.js';
import { validateWorkflow } from './validate.js';

const evaluator = new IsolateEvaluator({ timeoutMs: 2000 });
afterAll(() => {
  evaluator.disposeAll();
});

/** Ferramenta de teste: devolve o valor resolvido com `$fromAI` (pelo sandbox de expressões). */
const testTool: NodeDefinition = {
  type: 'test.tool',
  version: 1,
  displayName: 'Ferramenta de teste',
  description: 'Teste',
  icon: 'code',
  category: 'ai',
  inputs: [],
  outputs: [{ name: 'ai_tool', kind: 'ai_tool' }],
  paramsSchema: {
    type: 'object',
    properties: {
      toolName: { type: 'string' },
      toolDescription: { type: 'string' },
      requireApproval: { type: 'boolean' },
      valor: { type: 'string' },
    },
  },
  execute: () => Promise.reject(new Error('sub-nó')),
  supplyData: (ctx, itemIndex): Promise<AgentTool[]> =>
    Promise.resolve([
      {
        name: String(ctx.getParam('toolName', itemIndex)),
        description: String(ctx.getParam('toolDescription', itemIndex)),
        schema: { type: 'object', properties: { termo: { type: 'string' } } },
        requireApproval: ctx.getParam('requireApproval', itemIndex) === true,
        sideEffects: false,
        external: false,
        source: 'teste',
        invoke: async (args) => {
          const resolve = await ctx.withFromAI(args, itemIndex);
          return { recebido: resolve('valor'), cliente: ctx.getParam('toolName', itemIndex) };
        },
      },
    ]),
};

const registry = createNodeRegistry([...builtinNodes, testTool]);

function gateway() {
  const steps: AgentStepInput[] = [];
  const usage: AiUsageInput[] = [];
  const ai: AiGateway = {
    checkModel: ({ model }) =>
      model === 'proibido'
        ? Promise.reject(new Error('Modelo "proibido" não permitido'))
        : Promise.resolve(),
    beforeModelCall: () => Promise.resolve(),
    recordUsage: (u) => {
      usage.push(u);
      return Promise.resolve();
    },
    recordStep: (s) => {
      steps.push(s);
      return Promise.resolve();
    },
    persistentMemory: () => ({ load: () => Promise.resolve([]), append: () => Promise.resolve() }),
    executionMemory: () => ({ load: () => Promise.resolve([]), append: () => Promise.resolve() }),
    fetch,
    limits: { maxIterations: 25, toolResultMaxChars: 20_000 },
    allowFakeModel: true,
  };
  return { ai, steps, usage };
}

const node = (
  id: string,
  type: string,
  params: Record<string, unknown> = {},
  extra: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id,
  type,
  name: id,
  params,
  position: [0, 0],
  ...extra,
});
const e = (from: string, to: string, fromPort = 'main', toPort = 'main'): Edge => ({
  id: `${from}.${fromPort}-${to}.${toPort}`,
  from,
  fromPort,
  to,
  toPort,
});

function agentWorkflow(
  model = 'fake-model',
  toolParams: Record<string, unknown> = {},
): WorkflowDefinition {
  return {
    nodes: [
      node('m', 'trigger.manual'),
      node('agent', 'ai.agent', { promptSource: 'define', text: '={{ $json.pergunta }}' }),
      node('modelo', 'ai.chatModel', { model }, { credentialId: 'cred-fake' }),
      node('busca', 'test.tool', {
        toolName: 'buscar',
        toolDescription: 'Busca um termo',
        valor: "=termo={{ $fromAI('termo', 'O que buscar') }}",
        ...toolParams,
      }),
    ],
    edges: [
      e('m', 'agent'),
      e('modelo', 'agent', 'ai_languageModel', 'ai_languageModel'),
      e('busca', 'agent', 'ai_tool', 'ai_tool'),
    ],
    settings: {},
  };
}

const credentials = (script: FakeModelStep[]) => () =>
  Promise.resolve({
    credential: {
      id: 'cred-fake',
      type: 'fakeLlm',
      data: { script: JSON.stringify(script) },
      updatedAt: '',
    },
    secrets: [],
  });

describe('spec 011 — FR-001: sub-nós no editor e no motor', () => {
  it('FR-001: exige exatamente 1 modelo, no máximo 1 memória; sub-nó não entra no fluxo principal', () => {
    const base = agentWorkflow();
    const codes = (def: WorkflowDefinition) =>
      validateWorkflow(def, registry).errors.map((i) => i.code);
    expect(codes(base)).toEqual([]);
    expect(
      codes({ ...base, edges: base.edges.filter((x) => x.fromPort !== 'ai_languageModel') }),
    ).toContain('AGENT_MODEL_REQUIRED');
    const twoMemories: WorkflowDefinition = {
      ...base,
      nodes: [...base.nodes, node('mem1', 'memory.buffer'), node('mem2', 'memory.buffer')],
      edges: [
        ...base.edges,
        e('mem1', 'agent', 'ai_memory', 'ai_memory'),
        e('mem2', 'agent', 'ai_memory', 'ai_memory'),
      ],
    };
    expect(codes(twoMemories)).toContain('AGENT_MEMORY_MAX');
    expect(
      codes({ ...base, edges: [...base.edges, e('modelo', 'agent', 'ai_languageModel', 'main')] }),
    ).toContain('SUBNODE_ON_MAIN');
  });

  it('FR-007: ferramenta com nome inválido, repetido ou sem descrição é recusada', () => {
    const base = agentWorkflow('fake-model', { toolDescription: '' });
    const withDuplicate: WorkflowDefinition = {
      ...base,
      nodes: [
        ...base.nodes,
        node('busca2', 'test.tool', { toolName: 'buscar', toolDescription: 'x' }),
        node('ruim', 'test.tool', { toolName: 'nome com espaço', toolDescription: 'x' }),
      ],
      edges: [
        ...base.edges,
        e('busca2', 'agent', 'ai_tool', 'ai_tool'),
        e('ruim', 'agent', 'ai_tool', 'ai_tool'),
      ],
    };
    const codes = validateWorkflow(withDuplicate, registry).errors.map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'TOOL_DESCRIPTION_REQUIRED',
        'TOOL_NAME_DUPLICATE',
        'TOOL_NAME_INVALID',
      ]),
    );
  });

  it('FR-003/FR-007: o Agent usa o modelo e a ferramenta ($fromAI resolvido no sandbox)', async () => {
    const { ai, steps, usage } = gateway();
    const records: NodeRunRecord[] = [];
    const result = await runWorkflow(agentWorkflow(), registry, {
      evaluator,
      ai,
      credentials: credentials([
        { toolCalls: [{ name: 'buscar', args: { termo: 'abc' } }] },
        { content: 'Achei: {{lastTool}}' },
      ]),
      triggerItems: [{ json: { pergunta: 'Procure abc' } }],
      callbacks: { onNodeFinish: (r) => void records.push(r) },
    });
    expect(result.status).toBe('success');
    const output = result.nodes.agent?.output?.main?.[0]?.json;
    expect(String(output?.output)).toContain('"recebido":"termo=abc"');
    expect(output?.usage).toMatchObject({ model: 'fake-model' });
    // Sub-nós não aparecem como execuções de nó; os passos e o uso vão ao gateway.
    expect(records.map((r) => r.nodeId)).toEqual(['m', 'agent']);
    expect(steps.map((s) => s.kind)).toEqual(['model', 'tool', 'model', 'final']);
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({ nodeId: 'agent', provider: 'fake', model: 'fake-model' });
  });

  it('FR-002/SC-006: modelo fora da lista é recusado', async () => {
    const { ai } = gateway();
    const result = await runWorkflow(agentWorkflow('proibido'), registry, {
      evaluator,
      ai,
      credentials: credentials([{ content: 'x' }]),
      triggerItems: [{ json: { pergunta: 'oi' } }],
    });
    expect(result.status).toBe('error');
    expect(result.nodes.agent?.error).toContain('Modelo "proibido" não permitido');
  });

  it('NFR-001: limite padrão de 10 iterações; o teto da instalação prevalece', async () => {
    const loop: FakeModelStep[] = [
      { toolCalls: [{ name: 'buscar', args: { termo: 'x' } }], repeat: true },
    ];
    const run = async (agentParams: Record<string, unknown>, ceiling: number) => {
      const { ai } = gateway();
      const definition = agentWorkflow();
      const agent = definition.nodes.find((n) => n.id === 'agent');
      if (agent) agent.params = { ...agent.params, ...agentParams };
      const result = await runWorkflow(definition, registry, {
        evaluator,
        ai: { ...ai, limits: { ...ai.limits, maxIterations: ceiling } },
        credentials: credentials(loop),
        triggerItems: [{ json: { pergunta: 'oi' } }],
      });
      return result.nodes.agent?.error;
    };
    expect(await run({}, 25)).toContain('limite de 10 iterações');
    expect(await run({ maxIterations: 50 }, 4)).toContain('limite de 4 iterações');
  });

  it('FR-010: ferramenta com aprovação pausa a execução; a decisão retoma e o agente continua', async () => {
    const { ai } = gateway();
    const definition = agentWorkflow('fake-model', { requireApproval: true });
    const script: FakeModelStep[] = [
      { toolCalls: [{ name: 'buscar', args: { termo: 'x' } }] },
      { content: 'Resultado: {{lastTool}}' },
    ];
    const first = await runWorkflow(definition, registry, {
      evaluator,
      ai,
      credentials: credentials(script),
      triggerItems: [{ json: { pergunta: 'busque' } }],
    });
    expect(first.status).toBe('waiting');
    const approvals = first.waiting?.[0]?.request.approvals ?? [];
    expect(approvals).toEqual([
      expect.objectContaining({ itemIndex: 0, tool: 'buscar', arguments: { termo: 'x' } }),
    ]);
    const key = approvals[0]?.key ?? '';
    const snapshot = JSON.parse(JSON.stringify(first.snapshot)) as EngineSnapshot;
    // Na retomada o modelo é instanciado de novo e, sem estado, continua o roteiro pela conversa.
    const second = await runWorkflow(definition, registry, {
      evaluator,
      ai,
      credentials: credentials(script),
      resume: { snapshot, values: { agent: { approvals: { [key]: { approved: true } } } } },
    });
    expect(second.status).toBe('success');
    expect(String(second.nodes.agent?.output?.main?.[0]?.json.output)).toContain('termo=x');
  });
});
