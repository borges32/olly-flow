import { HTTP_CREDENTIAL_TYPES } from '../../credentials/definitions.js';
import type { JSONSchema7, NodeDefinition } from '../../types.js';
import { executeHttpRequest, type HttpRequestDeps } from './execute.js';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export const HTTP_CONTENT_TYPES = [
  'json',
  'form-urlencoded',
  'multipart',
  'raw',
  'binary',
] as const;
export const HTTP_RESPONSE_FORMATS = ['auto', 'json', 'text', 'binary'] as const;
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
export const DEFAULT_HTTP_MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

const nameValue = (title: string, extra: Record<string, JSONSchema7> = {}): JSONSchema7 => ({
  type: 'array',
  title,
  default: [],
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', title: 'Nome', minLength: 1 },
      value: { type: 'string', title: 'Valor', default: '' },
      ...extra,
    },
    required: ['name'],
    additionalProperties: false,
  },
});

const whenBody = (contentTypes: string[]) => ({
  'x-display-options': { show: { sendBody: [true], contentType: contentTypes } },
});

export const httpRequestParamsSchema: JSONSchema7 = {
  type: 'object',
  required: ['url'],
  properties: {
    method: { type: 'string', title: 'Método', enum: [...HTTP_METHODS], default: 'GET' },
    url: { type: 'string', title: 'URL', minLength: 1, default: '' },
    authentication: {
      type: 'string',
      title: 'Autenticação',
      description:
        '`credential` usa a credencial selecionada no nó (Bearer, Basic, header, query ou OAuth2).',
      enum: ['none', 'credential'],
      default: 'none',
    },
    queryParameters: nameValue('Parâmetros de query'),
    headers: nameValue('Cabeçalhos'),
    sendBody: { type: 'boolean', title: 'Enviar corpo', default: false },
    contentType: {
      type: 'string',
      title: 'Tipo do corpo',
      enum: [...HTTP_CONTENT_TYPES],
      default: 'json',
      'x-display-options': { show: { sendBody: [true] } },
    } as JSONSchema7,
    jsonBody: {
      type: 'string',
      title: 'JSON',
      description: 'Texto JSON ou expressão que produz um objeto.',
      default: '{}',
      'x-multiline': true,
      ...whenBody(['json']),
    } as JSONSchema7,
    bodyParameters: {
      ...nameValue('Campos do corpo', {
        parameterType: {
          type: 'string',
          title: 'Tipo',
          description: '`binary`: o valor é o nome da propriedade binária do item (multipart).',
          enum: ['text', 'binary'],
          default: 'text',
        },
      }),
      ...whenBody(['form-urlencoded', 'multipart']),
    } as JSONSchema7,
    rawBody: {
      type: 'string',
      title: 'Corpo',
      default: '',
      'x-multiline': true,
      ...whenBody(['raw']),
    } as JSONSchema7,
    rawContentType: {
      type: 'string',
      title: 'Content-Type',
      default: 'text/plain',
      ...whenBody(['raw']),
    } as JSONSchema7,
    inputBinaryField: {
      type: 'string',
      title: 'Propriedade binária de entrada',
      default: 'data',
      ...whenBody(['binary']),
    } as JSONSchema7,
    options: {
      type: 'object',
      title: 'Opções',
      default: {},
      properties: {
        timeout: {
          type: 'integer',
          title: 'Timeout (ms)',
          minimum: 1,
          default: DEFAULT_HTTP_TIMEOUT_MS,
        },
        followRedirects: { type: 'boolean', title: 'Seguir redirecionamentos', default: true },
        maxRedirects: {
          type: 'integer',
          title: 'Máximo de redirecionamentos',
          minimum: 0,
          default: 5,
        },
        fullResponse: {
          type: 'boolean',
          title: 'Resposta completa',
          description: 'Inclui status e cabeçalhos na saída.',
          default: false,
        },
        responseFormat: {
          type: 'string',
          title: 'Formato da resposta',
          enum: [...HTTP_RESPONSE_FORMATS],
          default: 'auto',
        },
        outputBinaryField: {
          type: 'string',
          title: 'Propriedade binária de saída',
          default: 'data',
        },
        neverError: {
          type: 'boolean',
          title: 'Não falhar em status de erro',
          description: 'Status 4xx/5xx viram saída normal.',
          default: false,
        },
        batchSize: {
          type: 'integer',
          title: 'Itens por lote',
          description: 'Requisições simultâneas por lote (1 = uma por vez).',
          minimum: 1,
          default: 1,
        },
        batchIntervalMs: {
          type: 'integer',
          title: 'Intervalo entre lotes (ms)',
          minimum: 0,
          default: 0,
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

/** HTTP Request (spec 004, FR-009, FR-010, plan §5). Uma requisição por item. */
export function createHttpRequestNode(deps: HttpRequestDeps): NodeDefinition {
  return {
    type: 'http.request',
    version: 1,
    displayName: 'Requisição HTTP',
    description:
      'Chama uma API HTTP para cada item, com autenticação, corpo e tratamento da resposta.',
    icon: 'globe',
    category: 'integration',
    inputs: [{ name: 'main', kind: 'main' }],
    outputs: [{ name: 'main', kind: 'main' }],
    // Spec 006, FR-009: itens em paralelo (aba Configurações do nó).
    supportsParallelItems: true,
    credentialTypes: [...HTTP_CREDENTIAL_TYPES],
    paramsSchema: httpRequestParamsSchema,
    execute: (input, ctx) => executeHttpRequest(input, ctx, deps),
  };
}
