import type { Item, NodeOutput } from '@olly/shared-types';
import {
  NodeParameterError,
  NodeWaitSignal,
  errorJson,
  failedItem,
  itemErrorMode,
  type NodeApprovalRequest,
} from '../../errors.js';
import type { JSONSchema7, NodeContext, NodeDefinition, NodeExecuteInput } from '../../types.js';
import {
  runAgent,
  type AgentRunResult,
  type AgentState,
  type ApprovalDecision,
} from '../runtime/agent.js';
import type { AgentTool, ChatModelSupply, MemorySupply } from '../runtime/types.js';

/** Limite padrão de iterações (NFR-001). */
export const DEFAULT_AGENT_ITERATIONS = 10;
export const DEFAULT_SYSTEM_MESSAGE = 'Você é um assistente útil.';

/** Estado do nó em espera: o resultado dos itens prontos e o agente pausado dos demais. */
interface AgentPauseData {
  items: Record<string, { done: Item } | { state: AgentState }>;
}

/** Decisões entregues pela API na retomada (spec 011, FR-011): chave → decisão. */
interface AgentResumeValue {
  approvals?: Record<string, ApprovalDecision>;
}

const approvalKey = (itemIndex: number, toolCallId: string) => `${String(itemIndex)}:${toolCallId}`;

type Outcome =
  | { kind: 'done'; item: Item }
  | { kind: 'paused'; state: AgentState; approvals: NodeApprovalRequest[] }
  | { kind: 'failed'; error: unknown };

function parseSchema(raw: unknown): Record<string, unknown> {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new NodeParameterError('schema', 'JSON Schema inválido');
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new NodeParameterError('schema', 'deve ser um objeto JSON Schema');
  }
  return value as Record<string, unknown>;
}

async function runItem(
  ctx: NodeContext,
  item: Item,
  itemIndex: number,
  resume: { state: AgentState; decisions: Record<string, ApprovalDecision> } | undefined,
): Promise<{ result: AgentRunResult; model: string }> {
  const ai = ctx.ai();
  const [modelSupply, ...extraModels] = await ctx.subNodes('ai_languageModel', itemIndex);
  if (!modelSupply || extraModels.length > 0) {
    throw new Error('Conecte exatamente um modelo de chat ao Agent');
  }
  const model = modelSupply.data as ChatModelSupply;
  const memories = await ctx.subNodes('ai_memory', itemIndex);
  if (memories.length > 1) throw new Error('Conecte no máximo uma memória ao Agent');
  const tools = (await ctx.subNodes('ai_tool', itemIndex)).flatMap((s) => s.data as AgentTool[]);
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name))
      throw new Error(`Duas ferramentas com o nome "${tool.name}" no Agent`);
    names.add(tool.name);
  }

  const promptSource = ctx.getParam('promptSource', itemIndex);
  const prompt = promptSource === 'define' ? ctx.getParam('text', itemIndex) : item.json.chatInput;
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new NodeParameterError(
      promptSource === 'define' ? 'text' : 'promptSource',
      promptSource === 'define'
        ? 'informe o texto do pedido'
        : 'o item não tem o campo "chatInput" (ou use "Definir abaixo")',
    );
  }
  const system = ctx.getParam('systemMessage', itemIndex);
  const requested = Number(ctx.getParam('maxIterations', itemIndex)) || DEFAULT_AGENT_ITERATIONS;
  const outputSchema =
    ctx.getParam('outputParser', itemIndex) === 'jsonSchema'
      ? parseSchema(ctx.getParam('schema', itemIndex))
      : undefined;
  const result = await runAgent({
    model,
    tools,
    ...(memories[0] && { memory: memories[0].data as MemorySupply }),
    systemMessage: typeof system === 'string' && system.trim() ? system : DEFAULT_SYSTEM_MESSAGE,
    prompt,
    // NFR-001: o teto global da instalação prevalece.
    maxIterations: Math.max(1, Math.min(requested, ai.limits.maxIterations)),
    ...(outputSchema && { outputSchema }),
    blockAfterUntrusted: ctx.getParam('blockToolCallsAfterUntrustedContent', itemIndex) === true,
    toolResultMaxChars: ai.limits.toolResultMaxChars,
    signal: ctx.signal,
    ...(resume && { resume }),
    hooks: {
      beforeModelCall: () => ai.beforeModelCall(),
      onUsage: (usage) =>
        ai.recordUsage({
          nodeId: ctx.node.id,
          provider: model.provider,
          model: model.model,
          ...usage,
        }),
      onStep: (s) =>
        ai.recordStep({ nodeId: ctx.node.id, runIndex: ctx.runIndex, itemIndex, ...s }),
    },
  });
  return { result, model: model.model };
}

async function executeAgent(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput> {
  const items = input.items.length > 0 ? input.items : [{ json: {} }];
  const mode = itemErrorMode(ctx.node.settings);
  const saved = ctx.resume?.data as AgentPauseData | undefined;
  const decisions = (ctx.resume?.value as AgentResumeValue | undefined)?.approvals ?? {};

  const outcomes = await ctx.mapItems(items, async (item, i): Promise<Outcome> => {
    const previous = saved?.items[String(i)];
    if (previous && 'done' in previous) return { kind: 'done', item: previous.done };
    try {
      const resume =
        previous && 'state' in previous
          ? {
              state: previous.state,
              // As decisões chegam pela chave item:chamada.
              decisions: Object.fromEntries(
                Object.entries(decisions)
                  .filter(([key]) => key.startsWith(`${String(i)}:`))
                  .map(([key, d]) => [key.slice(String(i).length + 1), d]),
              ),
            }
          : undefined;
      const { result, model } = await runItem(ctx, item, i, resume);
      if (result.kind === 'paused') {
        return {
          kind: 'paused',
          state: result.state,
          approvals: result.approvals.map((a) => ({
            key: approvalKey(i, a.toolCallId),
            itemIndex: i,
            tool: a.tool,
            arguments: a.arguments,
            reason: a.reason,
          })),
        };
      }
      const json: Record<string, unknown> = {
        output: result.output,
        usage: { ...result.usage, model },
      };
      if (ctx.getParam('returnIntermediateSteps', i) === true)
        json.intermediateSteps = result.steps;
      return { kind: 'done', item: { json, pairedItem: { item: i } } };
    } catch (error) {
      if (mode === 'stop') throw error;
      return { kind: 'failed', error };
    }
  });

  const paused = outcomes.filter(
    (o): o is Extract<Outcome, { kind: 'paused' }> => o.kind === 'paused',
  );
  if (paused.length > 0) {
    // FR-010: a execução pausa até as decisões; os itens prontos não executam de novo.
    const data: AgentPauseData = { items: {} };
    outcomes.forEach((o, i) => {
      if (o.kind === 'done') data.items[String(i)] = { done: o.item };
      else if (o.kind === 'paused') data.items[String(i)] = { state: o.state };
    });
    const approvals = paused.flatMap((p) => p.approvals);
    throw new NodeWaitSignal({
      reason: `Aguardando aprovação: ${[...new Set(approvals.map((a) => a.tool))].join(', ')}`,
      approvals,
      data,
    });
  }
  const main: Item[] = [];
  const failed: Item[] = [];
  outcomes.forEach((o, i) => {
    if (o.kind === 'done') main.push(o.item);
    else if (o.kind === 'failed') {
      if (mode === 'errorOutput') failed.push(failedItem(o.error, items[i]?.json ?? {}, i));
      else main.push({ json: errorJson(o.error), pairedItem: { item: i } });
    }
  });
  return mode === 'errorOutput' ? { main, error: failed } : { main };
}

/**
 * Agent (spec 011, FR-003 a FR-006, FR-010; plan §3): executa por item um agente com chamada de
 * ferramentas sobre o modelo, a memória e as ferramentas ligados à sua base. Equivale ao
 * "AI Agent" do N8N (tools agent).
 */
export const agentNode: NodeDefinition = {
  type: 'ai.agent',
  version: 1,
  displayName: 'Agent',
  description: 'Agente de IA que raciocina e usa ferramentas para responder ao pedido.',
  icon: 'bot',
  category: 'ai',
  inputs: [
    { name: 'main', kind: 'main' },
    {
      name: 'ai_languageModel',
      displayName: 'Modelo',
      kind: 'ai_languageModel',
      required: true,
      maxConnections: 1,
    },
    { name: 'ai_memory', displayName: 'Memória', kind: 'ai_memory', maxConnections: 1 },
    { name: 'ai_tool', displayName: 'Ferramentas', kind: 'ai_tool' },
  ],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: {
    type: 'object',
    properties: {
      promptSource: {
        type: 'string',
        title: 'Pedido',
        description: '`fromInput`: o campo `chatInput` do item; `define`: o texto abaixo.',
        enum: ['fromInput', 'define'],
        default: 'fromInput',
      },
      text: {
        type: 'string',
        title: 'Texto do pedido',
        default: '',
        'x-multiline': true,
        'x-display-options': { show: { promptSource: ['define'] } },
      } as JSONSchema7,
      systemMessage: {
        type: 'string',
        title: 'Mensagem de sistema',
        default: DEFAULT_SYSTEM_MESSAGE,
        'x-multiline': true,
      } as JSONSchema7,
      maxIterations: {
        type: 'integer',
        title: 'Máximo de iterações',
        description: 'Chamadas ao modelo por item; o teto da instalação prevalece.',
        minimum: 1,
        default: DEFAULT_AGENT_ITERATIONS,
      },
      returnIntermediateSteps: {
        type: 'boolean',
        title: 'Incluir os passos na saída',
        default: false,
      },
      outputParser: {
        type: 'string',
        title: 'Formato da resposta',
        description: '`jsonSchema`: a resposta é validada (até 2 pedidos de correção).',
        enum: ['none', 'jsonSchema'],
        default: 'none',
      },
      schema: {
        type: 'string',
        title: 'JSON Schema da resposta',
        default:
          '{"type":"object","properties":{"resposta":{"type":"string"}},"required":["resposta"]}',
        'x-multiline': true,
        'x-no-expression': true,
        'x-display-options': { show: { outputParser: ['jsonSchema'] } },
      } as JSONSchema7,
      blockToolCallsAfterUntrustedContent: {
        type: 'boolean',
        title: 'Aprovação após conteúdo externo',
        description:
          'Depois de ler um resultado externo (MCP, HTTP), ferramentas com efeitos colaterais passam a exigir aprovação.',
        default: false,
      },
    },
  },
  supportsParallelItems: true,
  execute: executeAgent,
};
