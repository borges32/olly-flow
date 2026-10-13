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

/** Manual → Basic LLM Chain, com o modelo principal e, se pedido, o reserva. */
function chainWorkflow(options: { fallback?: boolean; connectFallback?: boolean } = {}) {
  const definition: WorkflowDefinition = {
    nodes: [
      node('m', 'trigger.manual'),
      node('chain', 'ai.chainLlm', {
        promptSource: 'define',
        text: '={{ $json.pergunta }}',
        needsFallback: options.fallback === true,
      }),
      node('principal', 'ai.chatModel', { model: 'principal' }, { credentialId: 'cred-principal' }),
      node('reserva', 'ai.chatModel', { model: 'reserva' }, { credentialId: 'cred-reserva' }),
    ],
    edges: [
      e('m', 'chain'),
      e('principal', 'chain', 'ai_languageModel', 'ai_languageModel'),
      ...(options.connectFallback
        ? [e('reserva', 'chain', 'ai_languageModel', 'ai_fallbackModel')]
        : []),
    ],
    settings: {},
  };
  return definition;
}

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

describe('spec 017 — motor e validação do Basic LLM Chain', () => {
  it('FR-001/FR-011: exige o modelo; com o reserva habilitado, exige também o reserva', () => {
    const codes = (def: WorkflowDefinition) =>
      validateWorkflow(def, registry).errors.map((i) => i.message);
    expect(codes(chainWorkflow())).toEqual([]);
    const noModel = chainWorkflow();
    noModel.edges = noModel.edges.filter((x) => x.toPort !== 'ai_languageModel');
    expect(codes(noModel)).toEqual(['Nó "chain": conecte modelo (obrigatório)']);
    expect(codes(chainWorkflow({ fallback: true }))).toEqual([
      'Nó "chain": conecte modelo reserva (obrigatório)',
    ]);
    expect(codes(chainWorkflow({ fallback: true, connectFallback: true }))).toEqual([]);
    const two = chainWorkflow();
    two.edges.push(e('reserva', 'chain', 'ai_languageModel', 'ai_languageModel'));
    expect(codes(two)).toEqual(['Nó "chain": no máximo 1 conexão(ões) em modelo']);
  });

  it('FR-011: `subNodes` por entrada separa o principal do reserva', async () => {
    const { ai, usage, steps } = gateway();
    const result = await runWorkflow(
      chainWorkflow({ fallback: true, connectFallback: true }),
      registry,
      {
        evaluator,
        ai,
        // O principal não tem roteiro (falha); o reserva responde.
        credentials: scripts({ 'cred-reserva': [{ content: 'resposta do reserva' }] }),
        triggerItems: [{ json: { pergunta: 'Oi' } }],
      },
    );
    expect(result.status).toBe('success');
    expect(result.nodes.chain?.output?.main?.[0]?.json).toEqual({ text: 'resposta do reserva' });
    expect(usage.map((u) => u.model)).toEqual(['reserva']);
    expect(steps.map((s) => s.kind)).toEqual(['error', 'model', 'final']);
  });

  it('FR-002: sem o reserva habilitado, o reserva ligado não é usado', async () => {
    const { ai } = gateway();
    const result = await runWorkflow(chainWorkflow({ connectFallback: true }), registry, {
      evaluator,
      ai,
      credentials: scripts({
        'cred-principal': [{ content: 'do principal' }],
        'cred-reserva': [{ content: 'do reserva' }],
      }),
      triggerItems: [{ json: { pergunta: 'Oi' } }],
    });
    expect(result.nodes.chain?.output?.main?.[0]?.json).toEqual({ text: 'do principal' });
  });
});
