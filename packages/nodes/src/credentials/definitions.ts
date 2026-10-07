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

/** Spec 011, FR-002 (ADR-0008): API compatível com a OpenAI (OpenAI ou endpoint compatível). */
export const openAiCompatibleCredential: CredentialTypeDefinition = {
  name: 'openAiCompatible',
  displayName: 'IA: OpenAI (ou compatível)',
  description: 'Chave da API OpenAI ou de um provedor compatível (informe a URL base).',
  properties: {
    type: 'object',
    required: ['apiKey'],
    properties: {
      apiKey: secret('Chave da API'),
      baseURL: {
        type: 'string',
        title: 'URL base',
        description: 'Vazio: api.openai.com. Endpoints compatíveis passam pelo filtro anti-SSRF.',
        default: '',
      },
      organization: { type: 'string', title: 'Organização (opcional)', default: '' },
    },
  },
};

/** Spec 011, FR-002 (ADR-0008): Anthropic (Claude). */
export const anthropicCredential: CredentialTypeDefinition = {
  name: 'anthropic',
  displayName: 'IA: Anthropic (Claude)',
  description: 'Chave da API da Anthropic.',
  properties: {
    type: 'object',
    required: ['apiKey'],
    properties: {
      apiKey: secret('Chave da API'),
      baseURL: { type: 'string', title: 'URL base (opcional)', default: '' },
    },
  },
};

/** Spec 011, FR-002 (ADR-0008): Google (Gemini), pelo endpoint compatível com a OpenAI. */
export const googleGeminiCredential: CredentialTypeDefinition = {
  name: 'googleGemini',
  displayName: 'IA: Google (Gemini)',
  description: 'Chave da API do Gemini (Google AI Studio).',
  properties: {
    type: 'object',
    required: ['apiKey'],
    properties: {
      apiKey: secret('Chave da API'),
      baseURL: {
        type: 'string',
        title: 'URL base (opcional)',
        description: 'Vazio: endpoint compatível com a OpenAI do Gemini.',
        default: '',
      },
    },
  },
};

/**
 * Spec 011, FR-016: modelo simulado determinístico, com o roteiro de respostas e chamadas de
 * ferramenta (JSON). Registrado só com `NODE_ENV=test`.
 */
export const fakeLlmCredential: CredentialTypeDefinition = {
  name: 'fakeLlm',
  displayName: 'IA: modelo simulado (testes)',
  description: 'Roteiro determinístico para testes; não disponível em produção.',
  properties: {
    type: 'object',
    required: ['script'],
    properties: {
      script: {
        type: 'string',
        title: 'Roteiro (JSON)',
        minLength: 2,
        'x-multiline': true,
      } as JSONSchema7,
    },
  },
};

const insecureTlsField: JSONSchema7 = {
  type: 'boolean',
  title: 'Não verificar o certificado TLS',
  description:
    'Conecta mesmo que o certificado do servidor não possa ser verificado (ex.: CA interna). Deixa a conexão exposta a interceptação: prefira instalar a CA interna. O filtro de rede continua valendo.',
  default: false,
};

/**
 * Spec 016, FR-002: Bridge, o gateway interno de IA (modelo de chat customizado, ADR-0008). O
 * login de serviço devolve um token de curta duração, renovado pela plataforma. Sem endereços
 * padrão: o usuário informa todos.
 */
export const bridgeApiCredential: CredentialTypeDefinition = {
  name: 'bridgeApi',
  displayName: 'IA: Bridge',
  description:
    'Gateway interno de IA: login de serviço (identificador e senha) com token de curta duração, renovado automaticamente.',
  properties: {
    type: 'object',
    required: ['tokenUrl', 'baseUrl', 'identificador', 'senha'],
    properties: {
      tokenUrl: {
        type: 'string',
        title: 'URL de login',
        description:
          'Endpoint que troca identificador e senha por um token (~20 min). Endereços da rede interna são aceitos.',
        minLength: 1,
      },
      baseUrl: {
        type: 'string',
        title: 'URL base',
        description:
          'URL base do proxy de modelos da Bridge: o nó acrescenta deployments/{modelo}/chat/completions. Endereços da rede interna são aceitos.',
        minLength: 1,
      },
      identificador: { type: 'string', title: 'Identificador', minLength: 1 },
      senha: secret('Senha'),
      tokenSkewSeconds: {
        type: 'integer',
        title: 'Margem de renovação do token (s)',
        description:
          'Quantos segundos antes do vencimento ("exp") o token é renovado. Sem vencimento legível, vale 20 minutos menos esta margem.',
        minimum: 0,
        maximum: 600,
        default: 60,
      },
      allowUnauthorizedCerts: insecureTlsField,
    },
  },
};

/** Spec 016, FR-008: Agentix, a plataforma interna de agentes (chave no cabeçalho `X-API-Key`). */
export const agentixApiCredential: CredentialTypeDefinition = {
  name: 'agentixApi',
  displayName: 'Agentix',
  description: 'Plataforma interna de agentes: a chave vai no cabeçalho X-API-Key.',
  properties: {
    type: 'object',
    required: ['baseUrl', 'apiKey'],
    properties: {
      baseUrl: {
        type: 'string',
        title: 'URL base',
        description:
          'URL base da API do Agentix (ex.: …/v1): o nó chama sessions/invoke e sessions/{id}. Endereços da rede interna são aceitos.',
        minLength: 1,
      },
      apiKey: secret('Chave da API'),
      allowUnauthorizedCerts: insecureTlsField,
    },
  },
};

/** Tipos de credencial dos modelos de chat (spec 011, FR-002). */
export const CHAT_MODEL_CREDENTIAL_TYPES = [
  'openAiCompatible',
  'anthropic',
  'googleGemini',
  'fakeLlm',
] as const;

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
  // Spec 011 (o `fakeLlm` entra só nos testes; ver CredentialTypeRegistry).
  openAiCompatibleCredential,
  anthropicCredential,
  googleGeminiCredential,
  // Spec 016: Bridge (modelo de chat customizado) e Agentix.
  bridgeApiCredential,
  agentixApiCredential,
];

/** Tipos usados pelo `http.request` (autenticação por credencial). */
export const HTTP_CREDENTIAL_TYPES = [
  'httpBearer',
  'httpBasic',
  'httpHeaderAuth',
  'httpQueryAuth',
  'oauth2ClientCredentials',
] as const;
