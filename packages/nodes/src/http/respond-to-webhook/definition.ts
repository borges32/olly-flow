import type { BinaryRef } from '@olly/shared-types';
import { NodeParameterError } from '../../errors.js';
import type { JSONSchema7, NodeDefinition, WebhookResponse } from '../../types.js';

export const RESPOND_WITH = ['firstItemJson', 'allItemsJson', 'text', 'noData', 'binary'] as const;

const text = (v: unknown) =>
  typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v);

/**
 * Responder ao webhook (spec 005, FR-008): define status, cabeçalhos e corpo da resposta do
 * webhook com `responseMode: responseNode`. Só a primeira resposta vale; os itens seguem adiante.
 */
export const respondToWebhookNode: NodeDefinition = {
  type: 'http.respondToWebhook',
  version: 1,
  displayName: 'Responder ao webhook',
  description:
    'Envia a resposta da chamada que iniciou o workflow (webhook em modo "nó de resposta").',
  icon: 'reply',
  category: 'flow',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: {
    type: 'object',
    properties: {
      respondWith: {
        type: 'string',
        title: 'Responder com',
        enum: [...RESPOND_WITH],
        default: 'firstItemJson',
      },
      responseBody: {
        type: 'string',
        title: 'Texto',
        default: '',
        'x-multiline': true,
        'x-display-options': { show: { respondWith: ['text'] } },
      } as JSONSchema7,
      binaryProperty: {
        type: 'string',
        title: 'Propriedade binária',
        default: 'data',
        'x-display-options': { show: { respondWith: ['binary'] } },
      } as JSONSchema7,
      responseCode: { type: 'integer', title: 'Status', minimum: 100, maximum: 599, default: 200 },
      responseHeaders: {
        type: 'array',
        title: 'Cabeçalhos',
        default: [],
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', title: 'Nome', minLength: 1 },
            value: { type: 'string', title: 'Valor', default: '' },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  execute: (input, ctx) => {
    const items = input.items;
    const respondWith = text(ctx.getParam('respondWith', 0)) || 'firstItemJson';
    const code = ctx.getParam('responseCode', 0);
    const headers = Object.fromEntries(
      ((ctx.getParam('responseHeaders', 0) ?? []) as { name?: unknown; value?: unknown }[]).map(
        (h) => [text(h.name), text(h.value)],
      ),
    );
    let body: WebhookResponse['body'];
    switch (respondWith) {
      case 'allItemsJson':
        body = { kind: 'json', value: items.map((i) => i.json) };
        break;
      case 'text':
        body = { kind: 'text', value: text(ctx.getParam('responseBody', 0)) };
        break;
      case 'noData':
        body = undefined;
        break;
      case 'binary': {
        const property = text(ctx.getParam('binaryProperty', 0)) || 'data';
        const ref: BinaryRef | undefined = items[0]?.binary?.[property];
        if (!ref)
          throw new NodeParameterError(
            'binaryProperty',
            `o primeiro item não tem a propriedade binária "${property}"`,
          );
        body = { kind: 'binary', ref };
        break;
      }
      default:
        body = { kind: 'json', value: items[0]?.json ?? {} };
    }
    const accepted = ctx.respondToWebhook({
      statusCode: typeof code === 'number' && Number.isInteger(code) ? code : 200,
      headers,
      ...(body && { body }),
    });
    if (!accepted) ctx.logger.warn('O webhook já foi respondido; esta resposta foi ignorada');
    return Promise.resolve({ main: items });
  },
};
