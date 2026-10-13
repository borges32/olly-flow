import { IsolateEvaluator } from '@olly/expressions/isolate';
import {
  builtinNodes,
  createNodeRegistry,
  type AgentStepInput,
  type AiGateway,
  type AiUsageInput,
  type FakeModelStep,
} from '@olly/nodes';
import type { Edge, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { afterAll, describe, expect, it } from 'vitest';
import { runWorkflow, type CredentialResolver } from './run.js';
import { validateWorkflow } from './validate.js';

const evaluator = new IsolateEvaluator({ timeoutMs: 2000 });
afterAll(() => {
  evaluator.disposeAll();
});
const registry = createNodeRegistry(builtinNodes);

function gateway() {
  const usage: AiUsageInput[] = [];
  const steps: AgentStepInput[] = [];
  const ai: AiGateway = {
    checkModel: () => Promise.resolve(),
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
    fetchFor: () => fetch,
    limits: { maxIterations: 25, toolResultMaxChars: 20_000 },
    allowFakeModel: true,
  };
  return { ai, usage, steps };
}

const node = (
  id: string,
  type: string,
  params: Record<string, unknown> = {},
  extra: Partial<WorkflowNode> = {},
): WorkflowNode => ({ id, type, name: id, params, position: [0, 0], ...extra });
const e = (from: string, to: string, fromPort = 'main', toPort = 'main'): Edge => ({
  id: `${from}.${fromPort}-${to}.${toPort}`,
  from,
  fromPort,
  to,
  toPort,
});

const scripts =
  (byCredential: Record<string, FakeModelStep[]>): CredentialResolver =>
  (n) =>
    Promise.resolve({
      credential: {
        id: n.credentialId ?? '',
        type: 'fakeLlm',
        data: { script: JSON.stringify(byCredential[n.credentialId ?? ''] ?? []) },
        updatedAt: '',
      },
      secrets: [],
    });

/** Manual → Agent ou Basic LLM Chain com a opção ligada e o parser informado. */
function parserWorkflow(
  root: 'ai.agent' | 'ai.chainLlm',
  parsers: WorkflowNode[],
  parserEdges: Edge[],
) {
  const definition: WorkflowDefinition = {
    nodes: [
      node('m', 'trigger.manual'),
      node('root', root, {
        promptSource: 'define',
        text: '={{ $json.pergunta }}',
        hasOutputParser: true,
      }),
      node('modelo', 'ai.chatModel', { model: 'principal' }, { credentialId: 'cred-principal' }),
      ...parsers,
    ],
    edges: [
      e('m', 'root'),
      e('modelo', 'root', 'ai_languageModel', 'ai_languageModel'),
      ...parserEdges,
    ],
    settings: {},
  };
  return definition;
}

const SCHEMA = '{"type":"object","required":["nota"],"properties":{"nota":{"type":"number"}}}';
const structured = (id = 'formato', params: Record<string, unknown> = {}) =>
  node(id, 'outputParser.structured', { schemaType: 'manual', inputSchema: SCHEMA, ...params });

describe('spec 018 — motor e validação dos output parsers', () => {
  it('FR-001: com a opção ligada, o parser é obrigatório; o Auto-fixing exige modelo e parser', () => {
    const messages = (def: WorkflowDefinition) =>
      validateWorkflow(def, registry).errors.map((i) => i.message);
    expect(messages(parserWorkflow('ai.agent', [], []))).toEqual([
      'Nó "root": conecte output parser (obrigatório)',
    ]);
    const ok = parserWorkflow(
      'ai.chainLlm',
      [structured()],
      [e('formato', 'root', 'ai_outputParser', 'ai_outputParser')],
    );
    expect(messages(ok)).toEqual([]);
    const incompleteFixer = parserWorkflow(
      'ai.chainLlm',
      [node('fixer', 'outputParser.autoFixing')],
      [e('fixer', 'root', 'ai_outputParser', 'ai_outputParser')],
    );
    expect(messages(incompleteFixer)).toEqual([
      'Nó "fixer": conecte modelo (obrigatório)',
      'Nó "fixer": conecte output parser (obrigatório)',
    ]);
  });

  it('FR-002/FR-004: Auto-fixing com o próprio modelo e parser (sub-nós de sub-nó) corrige a resposta', async () => {
    const { ai, usage, steps } = gateway();
    const definition = parserWorkflow(
      'ai.chainLlm',
      [
        node('fixer', 'outputParser.autoFixing'),
        node('corretor', 'ai.chatModel', { model: 'corretor' }, { credentialId: 'cred-corretor' }),
        structured(),
      ],
      [
        e('fixer', 'root', 'ai_outputParser', 'ai_outputParser'),
        e('corretor', 'fixer', 'ai_languageModel', 'ai_languageModel'),
        e('formato', 'fixer', 'ai_outputParser', 'ai_outputParser'),
      ],
    );
    const result = await runWorkflow(definition, registry, {
      evaluator,
      ai,
      credentials: scripts({
        'cred-principal': [{ content: 'nota sete' }],
        'cred-corretor': [{ content: '{"nota": 7}' }],
      }),
      triggerItems: [{ json: { pergunta: 'Que nota?' } }],
    });
    expect(result.status).toBe('success');
    expect(result.nodes.root?.output?.main?.[0]?.json).toEqual({ output: { nota: 7 } });
    expect(usage.map((u) => u.model)).toEqual(['principal', 'corretor']);
    expect(steps.map((s) => s.kind)).toEqual(['model', 'model', 'final']);
    expect(steps[1]?.content).toMatchObject({ model: 'corretor', fixer: true });
  });

  it('FR-005: Agent com Item List devolve a lista em `output`', async () => {
    const { ai } = gateway();
    const definition = parserWorkflow(
      'ai.agent',
      [node('lista', 'outputParser.itemList')],
      [e('lista', 'root', 'ai_outputParser', 'ai_outputParser')],
    );
    const result = await runWorkflow(definition, registry, {
      evaluator,
      ai,
      credentials: scripts({ 'cred-principal': [{ content: '1. Azul\n2. Verde' }] }),
      triggerItems: [{ json: { pergunta: 'Duas cores' } }],
    });
    expect(result.nodes.root?.output?.main?.[0]?.json).toMatchObject({ output: ['Azul', 'Verde'] });
  });

  it('FR-004: sub-nós encadeados demais falham com o limite', async () => {
    const { ai } = gateway();
    const chain = Array.from({ length: 7 }, (_, i) =>
      node(`f${String(i)}`, 'outputParser.autoFixing'),
    );
    const definition = parserWorkflow('ai.chainLlm', chain, [
      e('f0', 'root', 'ai_outputParser', 'ai_outputParser'),
      ...chain
        .slice(1)
        .map((n, i) => e(n.id, `f${String(i)}`, 'ai_outputParser', 'ai_outputParser')),
      // Cada Auto-fixing tem o seu modelo (o mesmo nó, ligado a todos).
      ...chain.map((n) => e('modelo', n.id, 'ai_languageModel', 'ai_languageModel')),
    ]);
    const result = await runWorkflow(definition, registry, {
      evaluator,
      ai,
      credentials: scripts({ 'cred-principal': [{ content: 'x' }] }),
      triggerItems: [{ json: { pergunta: 'x' } }],
    });
    expect(result.status).toBe('error');
    expect(JSON.stringify(result.nodes.root?.error)).toContain('sub-nós encadeados demais');
  });
});
