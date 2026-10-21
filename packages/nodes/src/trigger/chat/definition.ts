import { randomUUID } from 'node:crypto';
import { CHAT_TRIGGER_TYPE } from '@olly/shared-types';
import type { JSONSchema7 } from 'json-schema';
import type { NodeDefinition } from '../../types.js';
import { CHAT_AUTHENTICATIONS, CHAT_DEFAULTS } from './config.js';

const text = (title: string, fallback: string, extra: Record<string, unknown> = {}) =>
  ({
    type: 'string',
    title,
    default: fallback,
    'x-no-expression': true,
    ...extra,
  }) as JSONSchema7;

/**
 * Gatilho de chat (spec 021), equivalente ao "When chat message received" do N8N
 * (`@n8n/n8n-nodes-langchain.chatTrigger`). A API recebe as mensagens (painel do editor, página
 * hospedada ou `/webhook/<webhookId>/chat`) e entrega um item `{ sessionId, action, chatInput }`
 * por mensagem (FR-001); o nó só repassa esse item. Os parâmetros valem antes de existir um item,
 * por isso não aceitam expressão.
 */
export const chatTrigger: NodeDefinition = {
  type: CHAT_TRIGGER_TYPE,
  version: 1,
  displayName: 'Mensagem de chat recebida',
  description: 'Inicia o workflow a cada mensagem de chat (painel do editor, página ou HTTP).',
  icon: 'message-circle',
  category: 'trigger',
  inputs: [],
  outputs: [{ name: 'main', kind: 'main' }],
  dynamicPorts: { kind: 'chatTriggerInputs' },
  credentialTypes: ['webhookBasicAuth'],
  paramsSchema: {
    type: 'object',
    properties: {
      // Identificador público do chat (URL `/webhook/<webhookId>/chat`), gerado pelo editor ao
      // criar ou colar o nó; na importação, vem do N8N.
      webhookId: { type: 'string', 'x-hidden': true, 'x-no-expression': true } as JSONSchema7,
      public: {
        type: 'boolean',
        title: 'Disponibilizar o chat publicamente',
        description: 'Depois de publicar o workflow, o chat responde fora do editor.',
        default: false,
      },
      mode: text('Modo', 'hostedChat', {
        description:
          '`hostedChat`: página de chat pronta, servida pela plataforma; `webhook`: só o endereço HTTP, para outros sistemas.',
        enum: ['hostedChat', 'webhook'],
        'x-display-options': { show: { public: [true] } },
      }),
      authentication: text('Autenticação', 'none', {
        description:
          '`basicAuth`: usuário e senha da credencial; `ollyUserAuth`: qualquer usuário logado no Olly Flow.',
        enum: [...CHAT_AUTHENTICATIONS],
        'x-display-options': { show: { public: [true] } },
      }),
      initialMessages: text('Mensagens iniciais', CHAT_DEFAULTS.initialMessages, {
        description: 'Uma mensagem por linha, exibidas ao abrir a página.',
        'x-multiline': true,
        'x-display-options': { show: { public: [true], mode: ['hostedChat'] } },
      }),
      options: {
        type: 'object',
        title: 'Opções',
        default: {},
        properties: {
          allowFileUploads: {
            type: 'boolean',
            title: 'Permitir envio de arquivos',
            default: false,
          },
          allowedFilesMimeTypes: text('Tipos de arquivo permitidos', '*', {
            description: 'Separados por vírgula, com curingas (ex.: `image/*,application/pdf`).',
            'x-display-options': { show: { allowFileUploads: [true] } },
          }),
          allowedOrigins: text('Origens permitidas (CORS)', '*', {
            description: 'Separadas por vírgula, ou `*`.',
          }),
          title: text('Título', CHAT_DEFAULTS.title),
          subtitle: text('Subtítulo', CHAT_DEFAULTS.subtitle),
          inputPlaceholder: text('Texto de exemplo do campo', CHAT_DEFAULTS.inputPlaceholder),
          showWelcomeScreen: {
            type: 'boolean',
            title: 'Mostrar tela de boas-vindas',
            default: false,
          },
          getStarted: text('Texto do botão de começar', CHAT_DEFAULTS.getStarted, {
            'x-display-options': { show: { showWelcomeScreen: [true] } },
          }),
          loadPreviousSession: text('Carregar sessão anterior', 'notSupported', {
            description:
              '`memory`: ao voltar, a página mostra o histórico da memória ligada a este nó.',
            enum: ['notSupported', 'memory'],
          }),
          responseMode: text('Responder', 'lastNode', {
            description:
              '`lastNode`: com a saída do último nó (`output` ou `text`); `responseNode`: pelo nó "Responder ao webhook"; `streaming`: o chat mostra o passo atual (nome do nó em execução) enquanto espera e a resposta do último nó no fim (spec 027). No `streaming`, quem conversa vê os nomes dos nós.',
            enum: ['lastNode', 'responseNode', 'streaming'],
          }),
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  execute: (input) =>
    Promise.resolve({
      main:
        input.items.length > 0
          ? input.items
          : // "Executar workflow" sem o painel de chat: uma mensagem vazia de uma sessão nova.
            [{ json: { sessionId: randomUUID(), action: 'sendMessage', chatInput: '' } }],
    }),
};
