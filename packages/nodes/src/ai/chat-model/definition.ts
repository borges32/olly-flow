import { CHAT_MODEL_CREDENTIAL_TYPES } from '../../credentials/definitions.js';
import { NodeParameterError } from '../../errors.js';
import type { JSONSchema7, NodeContext, NodeDefinition } from '../../types.js';
import { PROVIDER_BY_CREDENTIAL, createChatModel } from '../runtime/models.js';
import type { ChatModelSupply } from '../runtime/types.js';

/** Sub-nó: não executa no fluxo (FR-001). */
export const subNodeExecute = (displayName: string) => (): Promise<never> =>
  Promise.reject(
    new Error(`"${displayName}" é um sub-nó: conecte-o à base de um Agent em vez do fluxo`),
  );

/** Número do parâmetro; vazio (ou inválido) = `undefined`. */
const optionalNumber = (ctx: NodeContext, name: string, itemIndex: number) => {
  const raw = ctx.getParam(name, itemIndex);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
};
const number = (ctx: NodeContext, name: string, itemIndex: number, fallback: number) =>
  optionalNumber(ctx, name, itemIndex) ?? fallback;

/** Modelo do provedor da credencial, verificado na allowlist (FR-002, SC-006). */
async function supplyChatModel(ctx: NodeContext, itemIndex: number): Promise<ChatModelSupply> {
  const credential = await ctx.getCredential();
  const provider = PROVIDER_BY_CREDENTIAL[credential.type];
  if (!provider) throw new Error(`Credencial do tipo ${credential.type} não serve para modelos`);
  const ai = ctx.ai();
  if (provider === 'fake' && !ai.allowFakeModel) {
    throw new Error('O modelo simulado só é aceito em testes (NODE_ENV=test)');
  }
  const model = ctx.getParam('model', itemIndex);
  if (typeof model !== 'string' || !model.trim()) {
    throw new NodeParameterError('model', 'informe o modelo');
  }
  await ai.checkModel({ provider, model: model.trim() });
  return {
    provider,
    model: model.trim(),
    chatModel: createChatModel(credential, {
      model: model.trim(),
      // Só quando preenchidos: nem todo modelo aceita (ex.: gpt-5-mini só aceita o padrão).
      temperature: optionalNumber(ctx, 'temperature', itemIndex),
      topP: optionalNumber(ctx, 'topP', itemIndex),
      maxTokens: number(ctx, 'maxTokens', itemIndex, 0),
      timeoutMs: number(ctx, 'timeoutMs', itemIndex, 60_000),
      maxRetries: number(ctx, 'maxRetries', itemIndex, 2),
      fetch: ai.fetch,
    }),
  };
}

/**
 * Modelo de chat (spec 011, FR-002, plan §2): sub-nó do Agent. O provedor vem da credencial
 * (OpenAI ou compatível, Anthropic, Google), e o modelo precisa estar na lista permitida da
 * instalação e do projeto. Equivale aos nós "Chat Model" do N8N.
 */
export const chatModelNode: NodeDefinition = {
  type: 'ai.chatModel',
  version: 1,
  displayName: 'Modelo de chat',
  description: 'Modelo de linguagem (OpenAI, Claude ou Gemini) para um Agent.',
  icon: 'brain',
  category: 'ai',
  inputs: [],
  outputs: [{ name: 'ai_languageModel', displayName: 'Modelo', kind: 'ai_languageModel' }],
  credentialTypes: [...CHAT_MODEL_CREDENTIAL_TYPES],
  paramsSchema: {
    type: 'object',
    required: ['model'],
    properties: {
      model: {
        type: 'string',
        title: 'Modelo',
        description:
          'Ex.: gpt-4o-mini, claude-sonnet-5-5, gemini-2.5-flash. Precisa estar na lista permitida.',
        default: '',
        'x-load-options': 'aiModels',
        'x-no-expression': true,
      } as JSONSchema7,
      // Sem padrão (FR-002): vazio = o padrão do modelo; nem todo modelo aceita estes valores.
      temperature: {
        type: 'number',
        title: 'Temperatura',
        description:
          'Opcional (0 a 2). Vazio: o padrão do modelo. Alguns modelos (ex.: gpt-5, o-series) só aceitam o padrão.',
        minimum: 0,
        maximum: 2,
      },
      topP: {
        type: 'number',
        title: 'Top P',
        description:
          'Opcional (0 a 1). Vazio: o padrão do modelo. Em geral, ajuste a temperatura ou o top p, não os dois; alguns modelos não aceitam.',
        minimum: 0,
        maximum: 1,
      },
      maxTokens: {
        type: 'integer',
        title: 'Máximo de tokens da resposta',
        description: '0: o padrão do provedor.',
        minimum: 0,
        default: 0,
      },
      timeoutMs: {
        type: 'integer',
        title: 'Timeout (ms)',
        minimum: 1000,
        default: 60_000,
      },
      maxRetries: {
        type: 'integer',
        title: 'Tentativas em erro do provedor',
        minimum: 0,
        maximum: 10,
        default: 2,
      },
    },
  },
  execute: subNodeExecute('Modelo de chat'),
  supplyData: supplyChatModel,
};
