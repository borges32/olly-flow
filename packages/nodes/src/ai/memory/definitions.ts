import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from '@langchain/core/messages';
import { NodeParameterError } from '../../errors.js';
import type { JSONSchema7, NodeContext, NodeDefinition } from '../../types.js';
import { subNodeExecute } from '../chat-model/definition.js';
import type { AiMemoryStore, MemorySupply } from '../runtime/types.js';

/** Janela padrão de mensagens (FR-009). */
export const DEFAULT_CONTEXT_WINDOW = 10;

const memoryParams: JSONSchema7 = {
  type: 'object',
  required: ['sessionKey'],
  properties: {
    sessionKey: {
      type: 'string',
      title: 'Chave da sessão',
      description: 'Identifica a conversa (ex.: o id do usuário ou do chat). Aceita expressão.',
      default: '={{ $json.sessionId }}',
    },
    contextWindowLength: {
      type: 'integer',
      title: 'Mensagens lembradas',
      description: 'Quantas mensagens anteriores (perguntas e respostas) vão para o modelo.',
      minimum: 1,
      maximum: 200,
      default: DEFAULT_CONTEXT_WINDOW,
    },
  },
};

function supply(
  ctx: NodeContext,
  itemIndex: number,
  store: (sessionKey: string) => AiMemoryStore,
): MemorySupply {
  const raw = ctx.getParam('sessionKey', itemIndex);
  const sessionKey = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
  if (!sessionKey) {
    throw new NodeParameterError('sessionKey', 'a chave da sessão ficou vazia para este item');
  }
  const limit = Number(ctx.getParam('contextWindowLength', itemIndex)) || DEFAULT_CONTEXT_WINDOW;
  const memory = store(sessionKey);
  return {
    load: async () => mapStoredMessagesToChatMessages(await memory.load(limit)),
    save: (messages) => memory.append(mapChatMessagesToStoredMessages(messages)),
  };
}

/**
 * Memória persistente (spec 011, FR-009, plan §5): conversa por chave de sessão no banco do
 * projeto, com janela de N mensagens e retenção. Equivale à "Postgres Chat Memory" do N8N.
 */
export const postgresMemoryNode: NodeDefinition = {
  type: 'memory.postgres',
  version: 1,
  displayName: 'Memória persistente',
  description: 'Lembra a conversa entre execuções, pela chave da sessão.',
  icon: 'database-zap',
  category: 'ai',
  inputs: [],
  outputs: [{ name: 'ai_memory', displayName: 'Memória', kind: 'ai_memory' }],
  paramsSchema: memoryParams,
  execute: subNodeExecute('Memória persistente'),
  supplyData: (ctx, itemIndex) =>
    Promise.resolve(supply(ctx, itemIndex, (key) => ctx.ai().persistentMemory(key))),
};

/**
 * Memória temporária (spec 011, FR-009): só durante a execução (ex.: vários itens da mesma
 * conversa). Equivale à "Simple Memory" (buffer) do N8N.
 */
export const bufferMemoryNode: NodeDefinition = {
  type: 'memory.buffer',
  version: 1,
  displayName: 'Memória temporária',
  description: 'Lembra a conversa só durante esta execução.',
  icon: 'message-square',
  category: 'ai',
  inputs: [],
  outputs: [{ name: 'ai_memory', displayName: 'Memória', kind: 'ai_memory' }],
  paramsSchema: memoryParams,
  execute: subNodeExecute('Memória temporária'),
  supplyData: (ctx, itemIndex) =>
    Promise.resolve(supply(ctx, itemIndex, (key) => ctx.ai().executionMemory(ctx.node.id, key))),
};
