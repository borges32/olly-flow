import type { JSONSchema7 } from '../types.js';

/**
 * Tipo de credencial (spec 004, FR-004, plan §3). Campos com `x-secret` nunca saem da API e
 * são mascarados nos dados de execução.
 */
export interface CredentialTypeDefinition {
  name: string;
  displayName: string;
  description: string;
  properties: JSONSchema7;
  /** O teste precisa de uma URL informada pelo usuário (tipos HTTP genéricos, plan §10). */
  testRequiresUrl?: boolean;
}

/** Credencial decifrada entregue ao nó por `ctx.getCredential()`. */
export interface ResolvedCredential {
  id: string;
  type: string;
  data: Record<string, unknown>;
  updatedAt: string;
}

const secret = (title: string, extra: JSONSchema7 = {}): JSONSchema7 =>
  ({ type: 'string', title, minLength: 1, 'x-secret': true, ...extra }) as JSONSchema7;

const nameField: JSONSchema7 = { type: 'string', title: 'Nome', minLength: 1 };

export const httpBearerCredential: CredentialTypeDefinition = {
  name: 'httpBearer',
  displayName: 'Bearer token',
  description: 'Envia `Authorization: Bearer <token>`.',
  testRequiresUrl: true,
  properties: {
    type: 'object',
    required: ['token'],
    properties: { token: secret('Token') },
  },
};

export const httpBasicCredential: CredentialTypeDefinition = {
  name: 'httpBasic',
  displayName: 'Basic auth',
  description: 'Envia `Authorization: Basic` com usuário e senha.',
  testRequiresUrl: true,
  properties: {
    type: 'object',
    required: ['user', 'password'],
    properties: {
      user: { type: 'string', title: 'Usuário', minLength: 1 },
      password: secret('Senha'),
    },
  },
};

export const httpHeaderAuthCredential: CredentialTypeDefinition = {
  name: 'httpHeaderAuth',
  displayName: 'Header',
  description: 'Envia um cabeçalho com o valor secreto (ex.: `X-API-Key`).',
  testRequiresUrl: true,
  properties: {
    type: 'object',
    required: ['name', 'value'],
    properties: { name: nameField, value: secret('Valor') },
  },
};

export const httpQueryAuthCredential: CredentialTypeDefinition = {
  name: 'httpQueryAuth',
  displayName: 'Parâmetro de query',
  description: 'Acrescenta um parâmetro com o valor secreto à URL (ex.: `?api_key=`).',
  testRequiresUrl: true,
  properties: {
    type: 'object',
    required: ['name', 'value'],
    properties: { name: nameField, value: secret('Valor') },
  },
};

export const oauth2ClientCredentialsCredential: CredentialTypeDefinition = {
  name: 'oauth2ClientCredentials',
  displayName: 'OAuth2 (client credentials)',
  description: 'Obtém um token de acesso no servidor de autorização e o envia como Bearer.',
  properties: {
    type: 'object',
    required: ['tokenUrl', 'clientId', 'clientSecret'],
    properties: {
      tokenUrl: { type: 'string', title: 'URL do token', minLength: 1 },
      clientId: { type: 'string', title: 'Client ID', minLength: 1 },
      clientSecret: secret('Client secret'),
      scope: { type: 'string', title: 'Escopo', default: '' },
      authentication: {
        type: 'string',
        title: 'Envio do client secret',
        description: '`header`: Basic no cabeçalho (padrão do RFC 6749); `body`: no corpo.',
        enum: ['header', 'body'],
        default: 'header',
      },
    },
  },
};

export const POSTGRES_SSL_MODES = ['disable', 'require', 'verify-full'] as const;

export const postgresCredential: CredentialTypeDefinition = {
  name: 'postgres',
  displayName: 'PostgreSQL',
  description: 'Conexão com um banco PostgreSQL.',
  properties: {
    type: 'object',
    required: ['host', 'database', 'user', 'password'],
    properties: {
      host: { type: 'string', title: 'Host', minLength: 1 },
      port: { type: 'integer', title: 'Porta', minimum: 1, maximum: 65535, default: 5432 },
      database: { type: 'string', title: 'Banco', minLength: 1 },
      user: { type: 'string', title: 'Usuário', minLength: 1 },
      password: secret('Senha'),
      ssl: {
        type: 'string',
        title: 'SSL',
        description:
          '`require` cifra sem verificar o certificado (como no libpq); `verify-full` verifica o certificado e o nome do host.',
        enum: [...POSTGRES_SSL_MODES],
        default: 'disable',
      },
      caCert: {
        type: 'string',
        title: 'Certificado da CA (PEM)',
        description: 'Opcional, para `verify-full` com CA própria.',
        default: '',
        'x-multiline': true,
      } as JSONSchema7,
      readOnly: {
        type: 'boolean',
        title: 'Somente leitura',
        description: 'Consultas rodam em transação somente leitura; comandos de escrita falham.',
        default: false,
      },
    },
  },
};

/** Autenticação de webhooks recebidos (spec 005, FR-004). */
export const webhookHeaderAuthCredential: CredentialTypeDefinition = {
  name: 'webhookHeaderAuth',
  displayName: 'Webhook: header',
  description: 'O webhook só aceita chamadas com este cabeçalho e valor.',
  properties: {
    type: 'object',
    required: ['name', 'value'],
    properties: { name: nameField, value: secret('Valor') },
  },
};

export const webhookBasicAuthCredential: CredentialTypeDefinition = {
  name: 'webhookBasicAuth',
  displayName: 'Webhook: Basic auth',
  description: 'O webhook exige `Authorization: Basic` com este usuário e senha.',
  properties: {
    type: 'object',
    required: ['user', 'password'],
    properties: {
      user: { type: 'string', title: 'Usuário', minLength: 1 },
      password: secret('Senha'),
    },
  },
};

export const webhookHmacCredential: CredentialTypeDefinition = {
  name: 'webhookHmac',
  displayName: 'Webhook: assinatura HMAC',
  description:
    'O webhook exige um cabeçalho com o HMAC do corpo (aceita o prefixo `sha256=`, como no GitHub).',
  properties: {
    type: 'object',
    required: ['secret'],
    properties: {
      secret: secret('Segredo'),
      headerName: { type: 'string', title: 'Cabeçalho', minLength: 1, default: 'X-Signature' },
      algorithm: {
        type: 'string',
        title: 'Algoritmo',
        enum: ['sha256', 'sha1', 'sha512'],
        default: 'sha256',
      },
      encoding: { type: 'string', title: 'Codificação', enum: ['hex', 'base64'], default: 'hex' },
    },
  },
};

/** Spec 010, FR-007: `Authorization: Bearer` para o servidor MCP. */
export const mcpBearerCredential: CredentialTypeDefinition = {
  name: 'mcpBearer',
  displayName: 'MCP: Bearer token',
  description: 'Envia `Authorization: Bearer <token>` ao servidor MCP.',
  properties: {
    type: 'object',
    required: ['token'],
    properties: { token: secret('Token') },
  },
};

/**
 * Spec 010, FR-007: cabeçalhos para o servidor MCP, um por linha (`Nome: valor`). O campo
 * inteiro é secreto e cada valor entra no mascaramento.
 */
export const mcpHeadersCredential: CredentialTypeDefinition = {
  name: 'mcpHeaders',
  displayName: 'MCP: cabeçalhos',
  description: 'Cabeçalhos enviados ao servidor MCP, um por linha, no formato `Nome: valor`.',
  properties: {
    type: 'object',
    required: ['headers'],
    properties: { headers: secret('Cabeçalhos', { 'x-multiline': true } as JSONSchema7) },
  },
};

const hiddenSecret = { type: 'string', 'x-secret': true, 'x-hidden': true } as JSONSchema7;

/**
 * Spec 010, FR-007: OAuth 2.1 conforme a especificação MCP. Depois de salvar, "Conectar" faz a
 * descoberta, o registro dinâmico (sem Client ID), o Authorization Code + PKCE e guarda os
 * tokens cifrados nos campos ocultos; o token é renovado automaticamente.
 */
export const mcpOAuthCredential: CredentialTypeDefinition = {
  name: 'mcpOAuth',
  displayName: 'MCP: OAuth 2.1',
  description:
    'Autorização OAuth do servidor MCP (descoberta, PKCE e renovação automática). Salve e use "Conectar".',
  properties: {
    type: 'object',
    required: ['serverUrl'],
    properties: {
      serverUrl: { type: 'string', title: 'URL do servidor MCP', minLength: 1 },
      clientId: {
        type: 'string',
        title: 'Client ID',
        description: 'Vazio: registro dinâmico do cliente, se o servidor de autorização permitir.',
        default: '',
      },
      clientSecret: {
        type: 'string',
        title: 'Client secret (opcional)',
        default: '',
        'x-secret': true,
      } as JSONSchema7,
      scope: { type: 'string', title: 'Escopo', default: '' },
      accessToken: hiddenSecret,
      refreshToken: hiddenSecret,
      /** Cliente obtido pelo registro dinâmico (JSON). */
      registeredClient: hiddenSecret,
      expiresAt: { type: 'string', 'x-hidden': true } as JSONSchema7,
    },
  },
};

/** Spec 010: valores de cada linha `Nome: valor` (mascaramento dos cabeçalhos MCP). */
export function mcpHeaderLines(text: unknown): [string, string][] {
  if (typeof text !== 'string') return [];
  return text
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf(':');
      return i > 0
        ? ([line.slice(0, i).trim(), line.slice(i + 1).trim()] as [string, string])
        : null;
    })
    .filter((pair): pair is [string, string] => pair !== null && pair[0] !== '' && pair[1] !== '');
}

export const builtinCredentialTypes: readonly CredentialTypeDefinition[] = [
  httpBearerCredential,
  httpBasicCredential,
  httpHeaderAuthCredential,
  httpQueryAuthCredential,
  oauth2ClientCredentialsCredential,
  postgresCredential,
  webhookHeaderAuthCredential,
  webhookBasicAuthCredential,
  webhookHmacCredential,
  mcpBearerCredential,
  mcpHeadersCredential,
  mcpOAuthCredential,
];

/** Tipos usados pelo `http.request` (autenticação por credencial). */
export const HTTP_CREDENTIAL_TYPES = [
  'httpBearer',
  'httpBasic',
  'httpHeaderAuth',
  'httpQueryAuth',
  'oauth2ClientCredentials',
] as const;
