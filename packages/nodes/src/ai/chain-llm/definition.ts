import { FALLBACK_MODEL_PORT, type Item, type NodeOutput } from '@olly/shared-types';
import { NodeParameterError, errorJson, failedItem, itemErrorMode } from '../../errors.js';
import type { JSONSchema7, NodeContext, NodeDefinition, NodeExecuteInput } from '../../types.js';
import { outputParserOf } from '../agent/definition.js';
import { runChain, type ChainMessage } from '../runtime/chain.js';
import type { ChatModelSupply } from '../runtime/types.js';

export const CHAIN_LLM_TYPE = 'ai.chainLlm';

const ROLES = new Set<ChainMessage['role']>(['system', 'user', 'assistant']);

/** Exatamente um modelo ligado à entrada (FR-001, FR-011). */
async function modelOn(
  ctx: NodeContext,
  itemIndex: number,
  port: string,
  label: string,
): Promise<ChatModelSupply> {
  const [supply, ...extra] = await ctx.subNodes('ai_languageModel', itemIndex, { port });
  if (!supply || extra.length > 0) {
    throw new Error(`Conecte exatamente um modelo de chat à entrada "${label}" do Basic LLM Chain`);
  }
  return supply.data as ChatModelSupply;
}

/** Mensagens adicionais (FR-003): só as de texto preenchido, na ordem. */
function readMessages(raw: unknown): ChainMessage[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw new NodeParameterError('messages', 'deve ser uma lista');
  return raw.flatMap((entry: unknown) => {
    const { role, text } = (entry ?? {}) as { role?: unknown; text?: unknown };
    if (typeof text !== 'string' || !text.trim()) return [];
    const r = typeof role === 'string' && ROLES.has(role as ChainMessage['role']) ? role : 'user';
    return [{ role: r as ChainMessage['role'], text }];
  });
}

async function runItem(ctx: NodeContext, item: Item, itemIndex: number): Promise<Item> {
  const ai = ctx.ai();
  const model = await modelOn(ctx, itemIndex, 'ai_languageModel', 'Modelo');
  const fallback =
    ctx.getParam('needsFallback', itemIndex) === true
      ? await modelOn(ctx, itemIndex, FALLBACK_MODEL_PORT, 'Modelo reserva')
      : undefined;

  const promptSource = ctx.getParam('promptSource', itemIndex);
  const prompt = promptSource === 'define' ? ctx.getParam('text', itemIndex) : item.json.chatInput;
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new NodeParameterError(
      promptSource === 'define' ? 'text' : 'promptSource',
      promptSource === 'define'
        ? 'informe o texto do prompt'
        : 'o item não tem o campo "chatInput" (ou use "Definir abaixo")',
    );
  }
  const outputParser = await outputParserOf(ctx, itemIndex, 'Basic LLM Chain');

  const { json } = await runChain({
    model,
    ...(fallback && { fallback }),
    messages: readMessages(ctx.getParam('messages', itemIndex)),
    prompt,
    ...(outputParser && { outputParser }),
    signal: ctx.signal,
    hooks: {
      beforeModelCall: () => ai.beforeModelCall(),
      // FR-006/FR-011: uso com o provedor e o modelo que respondeu.
      onUsage: (usage, supply) =>
        ai.recordUsage({
          nodeId: ctx.node.id,
          provider: supply.provider,
          model: supply.model,
          ...usage,
        }),
      onStep: (step) =>
        ai.recordStep({ nodeId: ctx.node.id, runIndex: ctx.runIndex, itemIndex, ...step }),
    },
  });
  return { json, pairedItem: { item: itemIndex } };
}

/** Um item por chamada; o tratamento de erro vale por item (FR-007). */
async function executeChain(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput> {
  const items = input.items.length > 0 ? input.items : [{ json: {} }];
  const mode = itemErrorMode(ctx.node.settings);
  const failed: Item[] = [];
  const results = await ctx.mapItems(items, async (item, i): Promise<Item | undefined> => {
    try {
      return await runItem(ctx, item, i);
    } catch (error) {
      if (mode === 'stop' || ctx.signal.aborted) throw error;
      if (mode === 'errorOutput') {
        failed.push(failedItem(error, item.json, i));
        return undefined;
      }
      return { json: errorJson(error), pairedItem: { item: i } };
    }
  });
  const main = results.filter((r): r is Item => r !== undefined);
  return mode === 'errorOutput'
    ? { main, error: failed.sort((a, b) => (a.pairedItem?.item ?? 0) - (b.pairedItem?.item ?? 0)) }
    : { main };
}

/**
 * Basic LLM Chain (spec 017, plan §1): uma chamada ao modelo de chat ligado, por item, com o
 * prompt, mensagens adicionais e, opcionalmente, resposta em JSON Schema e modelo reserva.
 * Equivale ao "Basic LLM Chain" (`chainLlm`) do N8N.
 */
export const chainLlmNode: NodeDefinition = {
  type: CHAIN_LLM_TYPE,
  version: 1,
  displayName: 'Basic LLM Chain',
  description:
    'Envia um prompt ao modelo de chat e devolve a resposta (texto ou JSON), sem ferramentas nem memória.',
  icon: 'link',
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
  ],
  outputs: [{ name: 'main', kind: 'main' }],
  // FR-011: com `needsFallback`, a entrada "Modelo reserva"; spec 018: com `hasOutputParser`,
  // a entrada "Output Parser".
  dynamicPorts: { kind: 'aiRootInputs' },
  paramsSchema: {
    type: 'object',
    properties: {
      promptSource: {
        type: 'string',
        title: 'Prompt',
        description: '`fromInput`: o campo `chatInput` do item; `define`: o texto abaixo.',
        enum: ['fromInput', 'define'],
        default: 'fromInput',
      },
      text: {
        type: 'string',
        title: 'Texto do prompt',
        description: 'Aceita expressões, ex.: Resuma em uma frase: {{ $json.texto }}',
        default: '',
        'x-multiline': true,
        'x-display-options': { show: { promptSource: ['define'] } },
      } as JSONSchema7,
      messages: {
        type: 'array',
        title: 'Mensagens',
        description:
          'Enviadas antes do prompt, na ordem: instruções de sistema e exemplos de pergunta (user) e resposta (assistant).',
        default: [],
        items: {
          type: 'object',
          properties: {
            role: {
              type: 'string',
              title: 'Papel',
              enum: ['system', 'user', 'assistant'],
              default: 'system',
            },
            text: {
              type: 'string',
              title: 'Texto',
              default: '',
              'x-multiline': true,
            } as JSONSchema7,
          },
          required: ['role'],
          additionalProperties: false,
        },
      },
      hasOutputParser: {
        type: 'boolean',
        title: 'Exigir formato específico',
        description:
          'Acrescenta a entrada "Output Parser"; a resposta interpretada sai no campo `output` (sem parser: texto em `text`).',
        default: false,
      },
      needsFallback: {
        type: 'boolean',
        title: 'Modelo reserva',
        description:
          'Acrescenta a entrada "Modelo reserva", usada quando a chamada ao modelo principal falha.',
        default: false,
      },
    },
  },
  supportsParallelItems: true,
  execute: executeChain,
};
