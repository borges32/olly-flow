import { ChatOpenAI } from '@langchain/openai';
import { NodeParameterError } from '../../errors.js';
import type { JSONSchema7, NodeContext, NodeDefinition } from '../../types.js';
import { subNodeExecute } from '../chat-model/definition.js';
import type { ChatModelSupply } from '../runtime/types.js';
import { createBridgeFetch } from './bridge-fetch.js';
import { BridgeTokenManager } from './token-manager.js';

export const BRIDGE_CHAT_MODEL_TYPE = 'ai.bridgeChatModel';
export const BRIDGE_DEFAULT_TIMEOUT_MS = 360_000;

interface BridgeOptions {
  temperature?: number;
  topP?: number;
  maxTokens: number;
  n: number;
  stop: string[];
  user?: string;
  timeoutMs: number;
  maxRetries: number;
  streamUsage: boolean;
  sendModelInBody: boolean;
}

const finite = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function readOptions(raw: unknown): BridgeOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const user = typeof o.user === 'string' && o.user.trim() ? o.user.trim() : undefined;
  return {
    temperature: finite(o.temperature),
    topP: finite(o.topP),
    maxTokens: Math.max(0, Math.floor(finite(o.maxTokens) ?? 0)),
    n: Math.max(1, Math.floor(finite(o.n) ?? 1)),
    stop:
      typeof o.stop === 'string'
        ? o.stop
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    ...(user && { user }),
    timeoutMs: finite(o.timeoutMs) ?? BRIDGE_DEFAULT_TIMEOUT_MS,
    maxRetries: Math.max(0, Math.floor(finite(o.maxRetries) ?? 2)),
    streamUsage: o.streamUsage === true,
    sendModelInBody: o.sendModelInBody === true,
  };
}

/**
 * Modelo da Bridge para o Agent (spec 016, FR-001 a FR-006, plan §3). O cliente OpenAI do
 * LangChain chama `<URL base>/deployments/{modelo}/chat/completions` pelo `fetch` da Bridge
 * (token, `model` fora do corpo, novo login em 401/403), sempre pelo anti-SSRF, com as redes
 * internas aceitas (FR-013). Sem lista de modelos (FR-006): o nome é conferido pela Bridge.
 */
async function supplyBridgeModel(
  ctx: NodeContext,
  itemIndex: number,
  tokens: BridgeTokenManager,
): Promise<ChatModelSupply> {
  const credential = await ctx.getCredential();
  if (credential.type !== 'bridgeApi') {
    throw new Error(`Credencial do tipo ${credential.type} não serve para a Bridge`);
  }
  const rawModel = ctx.getParam('model', itemIndex);
  const model = typeof rawModel === 'string' ? rawModel.trim() : '';
  if (!model) throw new NodeParameterError('model', 'informe o modelo');
  const baseUrl = typeof credential.data.baseUrl === 'string' ? credential.data.baseUrl.trim() : '';
  if (!baseUrl) throw new Error('Credencial Bridge: informe o campo "baseUrl"');
  const stream = ctx.getParam('stream', itemIndex) !== false;
  const options = readOptions(ctx.getParam('options', itemIndex));
  const ai = ctx.ai();
  const fetchFn = ai.fetchFor({
    insecureTls: credential.data.allowUnauthorizedCerts === true,
    allowPrivateNetworks: true,
  });
  const chatModel = new ChatOpenAI({
    // A autenticação é do `fetch` da Bridge (token renovado a cada chamada).
    apiKey: 'token-gerenciado-pela-bridge',
    model,
    streaming: stream,
    streamUsage: stream && options.streamUsage,
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.topP !== undefined && { topP: options.topP }),
    ...(options.maxTokens > 0 && { maxTokens: options.maxTokens }),
    ...(options.n > 1 && { n: options.n }),
    ...(options.stop.length > 0 && { stop: options.stop }),
    ...(options.user && { user: options.user }),
    timeout: options.timeoutMs,
    // 401/403 não entram nas novas tentativas do LangChain: o `fetch` já trata (FR-005).
    maxRetries: options.maxRetries,
    configuration: {
      baseURL: `${baseUrl.replace(/\/+$/, '')}/deployments/${encodeURIComponent(model)}`,
      fetch: createBridgeFetch({
        credential,
        tokens,
        fetch: fetchFn,
        sendModelInBody: options.sendModelInBody,
        onToken: (token) => {
          ctx.helpers.registerSecret(token);
        },
      }),
    },
  });
  return { provider: 'bridge', model, chatModel };
}

const optionsSchema: JSONSchema7 = {
  type: 'object',
  title: 'Opções',
  default: {},
  properties: {
    temperature: {
      type: 'number',
      title: 'Temperatura',
      description: 'Opcional (0 a 2). Vazio: o padrão do modelo.',
      minimum: 0,
      maximum: 2,
    },
    topP: {
      type: 'number',
      title: 'Top P',
      description: 'Opcional (0 a 1). Em geral, ajuste a temperatura ou o top p, não os dois.',
      minimum: 0,
      maximum: 1,
    },
    maxTokens: {
      type: 'integer',
      title: 'Máximo de tokens da resposta',
      description: '0: o modelo decide.',
      minimum: 0,
      default: 0,
    },
    n: {
      type: 'integer',
      title: 'Número de respostas',
      description: 'Quantas respostas gerar para cada pedido (n).',
      minimum: 1,
      default: 1,
    },
    stop: {
      type: 'string',
      title: 'Sequências de parada',
      description: 'Lista separada por vírgula: o modelo para ao gerar uma delas.',
      default: '',
    },
    user: {
      type: 'string',
      title: 'Usuário final',
      description: 'Identificador do usuário final repassado à Bridge (user).',
      default: '',
    },
    timeoutMs: {
      type: 'integer',
      title: 'Timeout (ms)',
      minimum: 1000,
      default: BRIDGE_DEFAULT_TIMEOUT_MS,
    },
    maxRetries: {
      type: 'integer',
      title: 'Tentativas em erro da Bridge',
      description: 'Token recusado (401/403) não conta: o nó faz um novo login e repete uma vez.',
      minimum: 0,
      maximum: 10,
      default: 2,
    },
    streamUsage: {
      type: 'boolean',
      title: 'Pedir o uso de tokens no streaming',
      description:
        'Envia stream_options.include_usage. A Bridge não documenta este parâmetro: ligue só se o gateway aceitar. Sem ele, com streaming, o uso de tokens fica zerado.',
      default: false,
    },
    sendModelInBody: {
      type: 'boolean',
      title: 'Enviar o modelo também no corpo',
      description: 'A Bridge lê o modelo do endereço; por padrão o campo "model" não vai no corpo.',
      default: false,
    },
  },
};

/**
 * Bridge Chat Model (spec 016, HU-1): modelo de chat customizado do gateway interno de IA
 * (ADR-0008), sub-nó do Agent. Equivale ao nó customizado `bridgeChatModel` do N8N.
 */
export function createBridgeChatModelNode(
  deps: { tokens?: BridgeTokenManager } = {},
): NodeDefinition {
  const tokens = deps.tokens ?? new BridgeTokenManager();
  return {
    type: BRIDGE_CHAT_MODEL_TYPE,
    version: 1,
    displayName: 'Bridge Chat Model',
    description:
      'Modelo de chat customizado servido pela Bridge, o gateway interno de IA, para um Agent.',
    icon: 'waypoints',
    category: 'ai',
    inputs: [],
    outputs: [{ name: 'ai_languageModel', displayName: 'Modelo', kind: 'ai_languageModel' }],
    credentialTypes: ['bridgeApi'],
    paramsSchema: {
      type: 'object',
      required: ['model'],
      properties: {
        model: {
          type: 'string',
          title: 'Modelo',
          description:
            'Apelido do modelo na Bridge, enviado no endereço (deployments/{modelo}/chat/completions). Ex.: gemini-2.5-flash. Não há lista de modelos: a Bridge confere o nome.',
          default: '',
        },
        stream: {
          type: 'boolean',
          title: 'Streaming',
          description:
            'Recebe a resposta em partes. Mantenha ligado para evitar o tempo limite de proxies em respostas longas.',
          default: true,
        },
        options: optionsSchema,
      },
    },
    execute: subNodeExecute('Bridge Chat Model'),
    supplyData: (ctx, itemIndex) => supplyBridgeModel(ctx, itemIndex, tokens),
  };
}
