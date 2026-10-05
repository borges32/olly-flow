import type { JSONSchema7, NodeDefinition } from '../../types.js';

export const WEBHOOK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
export const WEBHOOK_AUTHENTICATIONS = ['none', 'headerAuth', 'basicAuth', 'hmac'] as const;
export const WEBHOOK_RESPONSE_MODES = ['onReceived', 'lastNode', 'responseNode'] as const;

/** Tipo de credencial exigido por cada autenticação do webhook. */
export const WEBHOOK_AUTH_CREDENTIAL: Record<string, string> = {
  headerAuth: 'webhookHeaderAuth',
  basicAuth: 'webhookBasicAuth',
  hmac: 'webhookHmac',
};

/**
 * Gatilho por webhook (spec 005, FR-004 a FR-006). A API recebe a chamada em `/webhook/<path>`
 * (publicado) ou `/webhook-test/<path>` (escuta do editor), autentica e entrega um item
 * `{ headers, params, query, body }`; o nó só repassa esse item.
 */
export const webhookTrigger: NodeDefinition = {
  type: 'trigger.webhook',
  version: 1,
  displayName: 'Webhook',
  description: 'Inicia o workflow quando uma URL recebe uma chamada HTTP.',
  icon: 'webhook',
  category: 'trigger',
  inputs: [],
  outputs: [{ name: 'main', kind: 'main' }],
  credentialTypes: Object.values(WEBHOOK_AUTH_CREDENTIAL),
  paramsSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      httpMethod: { type: 'string', title: 'Método', enum: [...WEBHOOK_METHODS], default: 'POST' },
      path: {
        type: 'string',
        title: 'Caminho',
        description: 'Ex.: `pedidos` ou `clientes/:id` (`:id` vira `params.id`).',
        minLength: 1,
        default: '',
        'x-no-expression': true,
      } as JSONSchema7,
      authentication: {
        type: 'string',
        title: 'Autenticação',
        description: 'Header, Basic ou HMAC usam a credencial selecionada no nó.',
        enum: [...WEBHOOK_AUTHENTICATIONS],
        default: 'none',
      },
      responseMode: {
        type: 'string',
        title: 'Responder',
        description:
          '`onReceived`: na hora (202 + id da execução); `lastNode`: com a saída do último nó; `responseNode`: pelo nó "Responder ao webhook".',
        enum: [...WEBHOOK_RESPONSE_MODES],
        default: 'onReceived',
      },
      options: {
        type: 'object',
        title: 'Opções',
        default: {},
        properties: {
          allowedOrigins: {
            type: 'string',
            title: 'Origens permitidas (CORS)',
            description: 'Separadas por vírgula, ou `*`. Vazio: sem CORS.',
            default: '',
          },
          ipAllowlist: {
            type: 'string',
            title: 'IPs permitidos',
            description: 'IPs ou CIDRs separados por vírgula. Vazio: qualquer IP.',
            default: '',
          },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  execute: (input) =>
    Promise.resolve({ main: input.items.length > 0 ? input.items : [{ json: {} }] }),
};
