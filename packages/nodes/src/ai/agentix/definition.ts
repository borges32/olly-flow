import type { Item, NodeOutput } from '@olly/shared-types';
import type { Response } from 'undici';
import type { ResolvedCredential } from '../../credentials/definitions.js';
import {
  NodeExecutionError,
  NodeParameterError,
  errorJson,
  failedItem,
  itemErrorMode,
} from '../../errors.js';
import type { HttpGuard } from '../../shared/http-guard.js';
import type { JSONSchema7, NodeContext, NodeDefinition, NodeExecuteInput } from '../../types.js';

export const AGENTIX_NODE_TYPE = 'ai.agentix';
export const AGENTIX_FAILURE_STATES = ['FAILED', 'CANCELLED', 'REJECTED'] as const;
const SUCCESS_STATE = 'DONE';
const ERROR_SNIPPET = 500;
/**
 * O nó se identifica: o `fetch` mandaria `user-agent: undici`, que WAFs e gateways corporativos
 * costumam barrar com 403.
 */
export const AGENTIX_USER_AGENT = 'Olly-Flow/1.0 (agentix)';
const AUTH_HINT = 'Confira a chave da API e a URL base da credencial (ex.: https://<host>/v2/api).';

export interface AgentixDeps {
  guard: HttpGuard;
  /** Limite do corpo das respostas (`OLLY_HTTP_MAX_RESPONSE_MB`). */
  maxResponseBytes: number;
}

interface AgentixOptions {
  pollIntervalMs: number;
  /** 0 = sem limite próprio (valem os limites do nó e do workflow). */
  timeoutMs: number;
  maxPollErrors: number;
  includeSession: boolean;
}

type Json = Record<string, unknown>;
type Request = (method: 'GET' | 'POST', path: string, body?: Json) => Promise<unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function readOptions(raw: unknown): AgentixOptions {
  const o = isObject(raw) ? raw : {};
  const num = (v: unknown, fallback: number, min: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback;
  return {
    pollIntervalMs: Math.max(num(o.pollIntervalSeconds, 3, 0), 0.1) * 1000,
    timeoutMs: num(o.timeoutSeconds, 600, 0) * 1000,
    maxPollErrors: Math.floor(num(o.maxPollErrors, 3, 0)),
    includeSession: o.includeSession === true,
  };
}

/** Payload e constantes: objeto JSON (texto ou resultado de expressão). */
function jsonObjectParam(ctx: NodeContext, name: string, itemIndex: number): Json {
  const value = ctx.getParam(name, itemIndex);
  if (value === undefined || value === null || value === '') return {};
  if (isObject(value)) return value;
  if (typeof value === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw new NodeParameterError(
        name,
        `não é um JSON válido (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    if (isObject(parsed)) return parsed;
  }
  throw new NodeParameterError(name, 'deve ser um objeto JSON');
}

function requiredText(ctx: NodeContext, name: string, itemIndex: number): string {
  const value = ctx.getParam(name, itemIndex);
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  if (!text.trim()) throw new NodeParameterError(name, 'é obrigatório');
  return text.trim();
}

/**
 * Raiz da API a partir da URL base da credencial. Aceita a URL colada com o endpoint (por
 * exemplo, `…/v2/api/sessions/invoke`, como no exemplo da API): o nó acrescenta os caminhos.
 */
export function agentixBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/sessions(\/.*)?$/, '')
    .replace(/\/+$/, '');
}

/** Estado da sessão: `state` na consulta, `status` na criação (exemplo da API). */
const stateOf = (session: Json): string => {
  const value = session.state ?? session.status;
  return typeof value === 'string' ? value.toUpperCase() : '';
};

/** Motivo de uma resposta de erro: `detail`, `message` ou `error` do JSON, ou o texto. */
function errorReason(text: string): string {
  try {
    const body = JSON.parse(text) as unknown;
    if (isObject(body)) {
      for (const key of ['detail', 'message', 'mensagem', 'error']) {
        const value = body[key];
        if (typeof value === 'string' && value) return value;
        if (value !== undefined && value !== null) return JSON.stringify(value).slice(0, 200);
      }
    }
  } catch {
    // Não é JSON: usa o texto.
  }
  return text.trim().slice(0, 200);
}

/** Erro de uma sessão em estado de falha, com o `error_message` quando houver. */
function failedSession(sessionId: string, state: string, session: Json): NodeExecutionError {
  const message =
    typeof session.error_message === 'string' && session.error_message
      ? `: ${session.error_message}`
      : '';
  return new NodeExecutionError(
    `Sessão ${sessionId} do Agentix terminou com o estado ${state}${message}`,
    { description: JSON.stringify(session).slice(0, ERROR_SNIPPET) },
  );
}

/** Lista de mensagens pura, ou embrulhada em `messages` ou `items`. */
export function extractMessages(response: unknown): Json[] {
  const list = Array.isArray(response)
    ? response
    : isObject(response)
      ? (response.messages ?? response.items)
      : undefined;
  return Array.isArray(list) ? list.filter(isObject) : [];
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Execução cancelada'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error('Execução cancelada'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Lê o corpo até o limite (a resposta nunca fica inteira na memória além dele). */
async function readText(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += (chunk as Uint8Array).byteLength;
    if (total > limit) {
      await response.body.cancel().catch(() => undefined);
      throw new NodeExecutionError(
        `Resposta do Agentix acima do limite de ${String(Math.round(limit / 1024 / 1024))} MB`,
      );
    }
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function createRequest(
  ctx: NodeContext,
  credential: ResolvedCredential,
  deps: AgentixDeps,
): Request {
  const data = credential.data;
  const baseUrl = agentixBaseUrl(data.baseUrl);
  const apiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : '';
  if (!baseUrl) throw new Error('Credencial Agentix: informe o campo "baseUrl"');
  if (!apiKey) throw new Error('Credencial Agentix: informe o campo "apiKey"');
  return async (method, path, body) => {
    const url = `${baseUrl}/${path}`;
    const response = await deps.guard.fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        'user-agent': AGENTIX_USER_AGENT,
        'x-api-key': apiKey,
        ...(body && { 'content-type': 'application/json' }),
      },
      ...(body && { body: JSON.stringify(body) }),
      signal: ctx.signal,
      // FR-008 e FR-013: TLS conforme a credencial; redes internas aceitas, sempre pelo filtro.
      insecureTls: data.allowUnauthorizedCerts === true,
      allowPrivateNetworks: true,
    });
    const text = await readText(response, deps.maxResponseBytes);
    if (!response.ok) {
      // O endereço não tem segredo (a chave vai no cabeçalho) e mostra uma URL base errada.
      const reason = errorReason(text);
      const auth = response.status === 401 || response.status === 403 ? ` ${AUTH_HINT}` : '';
      throw new NodeExecutionError(
        `Chamada ao Agentix falhou: ${method} ${url} respondeu ${String(response.status)}${reason ? ` (${reason})` : ''}.${auth}`,
        { httpCode: response.status, description: text.slice(0, ERROR_SNIPPET) },
      );
    }
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new NodeExecutionError(
        `A resposta do Agentix não é um JSON válido: ${method} ${path}`,
        {
          httpCode: response.status,
          description: text.slice(0, ERROR_SNIPPET),
        },
      );
    }
  };
}

/** Consulta a sessão até `DONE` (FR-009/FR-010), dormindo entre as consultas (FR-011). */
async function waitForSession(
  ctx: NodeContext,
  request: Request,
  sessionId: string,
  options: AgentixOptions,
): Promise<Json> {
  const deadline = options.timeoutMs > 0 ? Date.now() + options.timeoutMs : Infinity;
  const path = `sessions/${encodeURIComponent(sessionId)}`;
  let lastState = 'QUEUED';
  let errors = 0;
  for (;;) {
    let session: Json | undefined;
    try {
      const response = await request('GET', path);
      session = isObject(response) ? response : {};
      errors = 0;
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      errors += 1;
      if (errors > options.maxPollErrors) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new NodeExecutionError(
          `Sessão ${sessionId} do Agentix: ${String(errors)} erros seguidos ao consultar o estado (${reason})`,
          error instanceof NodeExecutionError ? error.details : {},
        );
      }
    }
    if (session) {
      lastState = stateOf(session) || lastState;
      if (lastState === SUCCESS_STATE) return session;
      if ((AGENTIX_FAILURE_STATES as readonly string[]).includes(lastState)) {
        throw failedSession(sessionId, lastState, session);
      }
    }
    if (Date.now() + options.pollIntervalMs > deadline) {
      throw new NodeExecutionError(
        `Tempo limite esgotado esperando a sessão ${sessionId} do Agentix (último estado: ${lastState})`,
        {
          description: `${
            lastState === 'BLOCKED'
              ? 'A sessão está pausada (BLOCKED), aguardando uma interação no Agentix. '
              : ''
          }Aumente "Tempo limite (s)" nas opções do nó, ou desligue "Esperar o fim" e consulte a sessão depois.`,
        },
      );
    }
    await sleep(options.pollIntervalMs, ctx.signal);
  }
}

async function runSession(ctx: NodeContext, request: Request, itemIndex: number): Promise<Json> {
  const body: Json = {
    entity_type: ctx.getParam('entityType', itemIndex) === 'workflow' ? 'workflow' : 'agent',
    entity_name: requiredText(ctx, 'entityName', itemIndex),
    entity_version: requiredText(ctx, 'entityVersion', itemIndex),
    bundle: requiredText(ctx, 'bundle', itemIndex),
    version: requiredText(ctx, 'bundleVersion', itemIndex),
    payload: jsonObjectParam(ctx, 'payload', itemIndex),
    constants: jsonObjectParam(ctx, 'constants', itemIndex),
  };
  const invoked = await request('POST', 'sessions/invoke', body);
  const invoke = isObject(invoked) ? invoked : {};
  const sessionId = invoke.session_id;
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new NodeExecutionError('O Agentix não devolveu o session_id da sessão criada', {
      description: JSON.stringify(invoked).slice(0, ERROR_SNIPPET),
    });
  }
  // A criação já pode vir recusada (`status`: REJECTED, FAILED ou CANCELLED).
  const created = stateOf(invoke);
  if ((AGENTIX_FAILURE_STATES as readonly string[]).includes(created)) {
    throw failedSession(sessionId, created, invoke);
  }
  if (ctx.getParam('waitForCompletion', itemIndex) === false) return invoke;

  const options = readOptions(ctx.getParam('options', itemIndex));
  const session = await waitForSession(ctx, request, sessionId, options);
  const messages = extractMessages(
    await request('GET', `sessions/${encodeURIComponent(sessionId)}/messages`),
  );
  const result: Json = { session_id: sessionId, state: stateOf(session) };
  if (ctx.getParam('output', itemIndex) === 'allMessages') {
    result.messages = messages;
  } else {
    const answer = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!answer) {
      throw new NodeExecutionError(
        `A sessão ${sessionId} do Agentix terminou sem uma mensagem "assistant"`,
        { description: JSON.stringify(messages).slice(0, ERROR_SNIPPET) },
      );
    }
    result.output = answer.content ?? '';
  }
  if (options.includeSession) result.session = session;
  return result;
}

/**
 * Uma sessão por item, em sequência (FR-009). O tratamento de erro do nó vale por item (FR-010):
 * "continuar" emite `{ error }`, "saída de erro" desvia o item para a porta `error`.
 */
async function executeAgentix(
  input: NodeExecuteInput,
  ctx: NodeContext,
  deps: AgentixDeps,
): Promise<NodeOutput> {
  const items = input.items.length > 0 ? input.items : [{ json: {} }];
  const credential = await ctx.getCredential();
  if (credential.type !== 'agentixApi') {
    throw new Error(`Credencial do tipo ${credential.type} não serve para o Agentix`);
  }
  const request = createRequest(ctx, credential, deps);
  const mode = itemErrorMode(ctx.node.settings);
  const main: Item[] = [];
  const failed: Item[] = [];
  for (const [i, item] of items.entries()) {
    try {
      main.push({ json: await runSession(ctx, request, i), pairedItem: { item: i } });
    } catch (error) {
      if (mode === 'stop' || ctx.signal.aborted) throw error;
      if (mode === 'errorOutput') failed.push(failedItem(error, item.json, i));
      else main.push({ json: errorJson(error), pairedItem: { item: i } });
    }
  }
  return mode === 'errorOutput' ? { main, error: failed } : { main };
}

const whenWaiting = { 'x-display-options': { show: { waitForCompletion: [true] } } };

const paramsSchema: JSONSchema7 = {
  type: 'object',
  required: ['entityName', 'entityVersion', 'bundle', 'bundleVersion'],
  properties: {
    entityType: {
      type: 'string',
      title: 'Tipo da entidade',
      description: 'Agente ou workflow do Agentix (entity_type).',
      enum: ['agent', 'workflow'],
      default: 'agent',
    },
    entityName: {
      type: 'string',
      title: 'Nome',
      description: 'Nome do agente ou workflow (entity_name).',
      default: '',
    },
    entityVersion: {
      type: 'string',
      title: 'Versão',
      description: 'Versão do agente ou workflow (entity_version).',
      default: '',
    },
    bundle: {
      type: 'string',
      title: 'Bundle',
      description: 'Bundle que contém a entidade (bundle).',
      default: '',
    },
    bundleVersion: {
      type: 'string',
      title: 'Versão do bundle',
      description: 'Versão do bundle (version).',
      default: '',
    },
    payload: {
      type: 'string',
      title: 'Payload',
      description:
        'Entrada do agente (payload): um objeto JSON. Aceita expressões, ex.: {"pergunta": "{{ $json.pergunta }}"}.',
      default: '{\n  "pergunta": ""\n}',
      'x-multiline': true,
    } as JSONSchema7,
    constants: {
      type: 'string',
      title: 'Constantes',
      description: 'Constantes do agente (constants): um objeto JSON.',
      default: '{}',
      'x-multiline': true,
    } as JSONSchema7,
    waitForCompletion: {
      type: 'boolean',
      title: 'Esperar o fim',
      description:
        'Consulta a sessão até o fim e devolve a resposta. Desligado: devolve na hora a resposta da criação (com o session_id).',
      default: true,
    },
    output: {
      type: 'string',
      title: 'Saída',
      description:
        '"finalAnswer": só o conteúdo da última mensagem "assistant"; "allMessages": a lista de mensagens da sessão.',
      enum: ['finalAnswer', 'allMessages'],
      default: 'finalAnswer',
      ...whenWaiting,
    } as JSONSchema7,
    options: {
      type: 'object',
      title: 'Opções',
      default: {},
      ...whenWaiting,
      properties: {
        pollIntervalSeconds: {
          type: 'number',
          title: 'Intervalo da consulta (s)',
          description: 'Tempo entre duas consultas ao estado da sessão (mínimo 0,1).',
          minimum: 0.1,
          default: 3,
        },
        timeoutSeconds: {
          type: 'number',
          title: 'Tempo limite (s)',
          description:
            'Tempo máximo de espera pela sessão. 0: sem limite próprio (valem os limites do nó e do workflow). A espera ocupa o worker.',
          minimum: 0,
          default: 600,
        },
        maxPollErrors: {
          type: 'integer',
          title: 'Erros de consulta seguidos tolerados',
          minimum: 0,
          default: 3,
        },
        includeSession: {
          type: 'boolean',
          title: 'Incluir os detalhes da sessão',
          description: 'Acrescenta a sessão final (uso de tokens, estado, datas) à saída.',
          default: false,
        },
      },
    } as JSONSchema7,
  },
};

/**
 * Agentix (spec 016, HU-2, plan §4): invoca um agente ou workflow do Agentix e espera a
 * resposta dentro do nó. Equivale ao nó customizado `agentix` do N8N.
 */
export function createAgentixNode(deps: AgentixDeps): NodeDefinition {
  return {
    type: AGENTIX_NODE_TYPE,
    version: 1,
    displayName: 'Agentix',
    description: 'Invoca um agente ou workflow do Agentix e devolve a resposta.',
    icon: 'bot-message-square',
    category: 'ai',
    inputs: [{ name: 'main', kind: 'main' }],
    outputs: [{ name: 'main', kind: 'main' }],
    credentialTypes: ['agentixApi'],
    supportsParallelItems: false,
    paramsSchema,
    execute: (input, ctx) => executeAgentix(input, ctx, deps),
  };
}
