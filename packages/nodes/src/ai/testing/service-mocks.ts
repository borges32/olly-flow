import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { TEST_TLS_CERT, TEST_TLS_KEY } from './test-tls.js';

/**
 * Serviços simulados da Bridge e do Agentix (spec 016, NFR-003): os testes de unidade e de
 * integração não dependem dos serviços reais. Seguem a API descrita na spec (login com
 * `identificador`/`senha`, `chat/completions` compatível com a OpenAI, sessões do Agentix) e
 * registram as chamadas para as verificações. Com `tls`, usam o certificado autoassinado de
 * teste (SC-001).
 */

type Handler = (req: IncomingMessage, body: string) => Promise<MockResponse> | MockResponse;
interface MockResponse {
  status: number;
  json?: unknown;
  /** Corpo em SSE (streaming). */
  events?: unknown[];
}

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });

async function listen(tls: boolean, handler: Handler): Promise<{ server: Server; origin: string }> {
  const listener = (req: IncomingMessage, res: import('node:http').ServerResponse) => {
    void readBody(req)
      .then((body) => handler(req, body))
      .then((out) => {
        if (out.events) {
          res.writeHead(out.status, { 'content-type': 'text/event-stream' });
          for (const event of out.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
          res.end('data: [DONE]\n\n');
          return;
        }
        res.writeHead(out.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.json ?? {}));
      })
      .catch((error: unknown) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(error) }));
      });
  };
  const server = tls
    ? createHttpsServer({ cert: TEST_TLS_CERT, key: TEST_TLS_KEY }, listener)
    : createHttpServer(listener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `${tls ? 'https' : 'http'}://127.0.0.1:${String(port)}` };
}

const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => {
      resolve();
    });
  });

const parse = (body: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

// ---------------------------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------------------------

/** Passo do roteiro do modelo: texto, chamadas de ferramenta ou um status de erro. */
export interface BridgeMockStep {
  content?: string;
  toolCalls?: { name: string; args: Record<string, unknown> }[];
  /** Responde com este status (ex.: 404 para modelo inexistente). */
  status?: number;
}

export interface BridgeMockOptions {
  tls?: boolean;
  identificador?: string;
  senha?: string;
  /** Validade do token emitido (`exp`); padrão 1200 s. */
  tokenTtlSeconds?: number;
  /** Token sem `exp` legível (vale a duração padrão do nó). */
  opaqueToken?: boolean;
  /** Atraso do login (para testar logins simultâneos). */
  loginDelayMs?: number;
  script?: BridgeMockStep[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface BridgeMockCall {
  model: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

export interface BridgeMock {
  origin: string;
  tokenUrl: string;
  baseUrl: string;
  identificador: string;
  senha: string;
  /** Logins aceitos. */
  readonly logins: number;
  readonly calls: BridgeMockCall[];
  /** Tokens emitidos (para a busca por sentinelas). */
  readonly tokens: string[];
  /** As próximas `n` chamadas ao modelo respondem 401, como um token recusado. */
  rejectNextCalls(n: number): void;
  /** Invalida os tokens emitidos (como se tivessem vencido no servidor). */
  expireTokens(): void;
  close(): Promise<void>;
}

export const BRIDGE_MOCK_IDENTIFICADOR = 'svc-olly';
export const BRIDGE_MOCK_SENHA = 'senha-sentinela-bridge-016';

export async function startBridgeMock(options: BridgeMockOptions = {}): Promise<BridgeMock> {
  const identificador = options.identificador ?? BRIDGE_MOCK_IDENTIFICADOR;
  const senha = options.senha ?? BRIDGE_MOCK_SENHA;
  const usage = options.usage ?? { prompt_tokens: 12, completion_tokens: 7 };
  const script = [...(options.script ?? [])];
  const valid = new Set<string>();
  const tokens: string[] = [];
  const calls: BridgeMockCall[] = [];
  let logins = 0;
  let reject = 0;

  const login = async (body: string): Promise<MockResponse> => {
    const data = parse(body);
    if (data.identificador !== identificador || data.senha !== senha) {
      return { status: 401, json: { mensagem: 'Usuário ou senha inválidos' } };
    }
    if (options.loginDelayMs) await new Promise((r) => setTimeout(r, options.loginDelayMs));
    logins += 1;
    const exp = Math.floor(Date.now() / 1000) + (options.tokenTtlSeconds ?? 1200);
    const token = options.opaqueToken
      ? `opaco-${String(logins)}-${Math.random().toString(36).slice(2)}`
      : `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: identificador, exp, n: logins })}.assinatura`;
    valid.add(token);
    tokens.push(token);
    return { status: 200, json: { token } };
  };

  const chat = (req: IncomingMessage, model: string, body: string): MockResponse => {
    const authorization = req.headers.authorization;
    const data = parse(body);
    calls.push({ model, authorization, body: data });
    const token = authorization?.replace(/^Bearer /, '') ?? '';
    if (reject > 0 || !valid.has(token)) {
      reject = Math.max(0, reject - 1);
      return { status: 401, json: { mensagem: 'Token inválido ou expirado' } };
    }
    const step = script.shift() ?? { content: 'ok' };
    if (step.status)
      return { status: step.status, json: { mensagem: `Erro simulado ${String(step.status)}` } };
    const toolCalls = (step.toolCalls ?? []).map((call, index) => ({
      index,
      id: `call_${String(calls.length)}_${String(index)}`,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.args) },
    }));
    const finish = toolCalls.length > 0 ? 'tool_calls' : 'stop';
    const base = {
      id: `cmpl-${String(calls.length)}`,
      created: Math.floor(Date.now() / 1000),
      model,
    };
    const usageBody = { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens };
    if (data.stream === true) {
      const events: unknown[] = [
        {
          ...base,
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: step.content ?? '' },
              finish_reason: null,
            },
          ],
        },
      ];
      if (toolCalls.length > 0)
        events.push({
          ...base,
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }],
        });
      events.push({
        ...base,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: finish }],
      });
      const streamOptions = data.stream_options as { include_usage?: boolean } | undefined;
      if (streamOptions?.include_usage)
        events.push({ ...base, object: 'chat.completion.chunk', choices: [], usage: usageBody });
      return { status: 200, events };
    }
    return {
      status: 200,
      json: {
        ...base,
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: step.content ?? null,
              ...(toolCalls.length > 0 && {
                tool_calls: toolCalls.map(({ index: _index, ...call }) => call),
              }),
            },
            finish_reason: finish,
          },
        ],
        usage: usageBody,
      },
    };
  };

  const { server, origin } = await listen(options.tls ?? false, (req, body) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (req.method === 'POST' && path === '/identity/v1/login') return login(body);
    const match = /^\/llm\/v1\/deployments\/([^/]+)\/chat\/completions$/.exec(path);
    if (req.method === 'POST' && match?.[1]) return chat(req, decodeURIComponent(match[1]), body);
    return { status: 404, json: { mensagem: `Rota inexistente: ${path}` } };
  });

  return {
    origin,
    tokenUrl: `${origin}/identity/v1/login`,
    baseUrl: `${origin}/llm/v1`,
    identificador,
    senha,
    get logins() {
      return logins;
    },
    calls,
    tokens,
    rejectNextCalls: (n) => {
      reject = n;
    },
    expireTokens: () => {
      valid.clear();
    },
    close: () => close(server),
  };
}

// ---------------------------------------------------------------------------------------------
// Agentix
// ---------------------------------------------------------------------------------------------

/** Roteiro de uma sessão, escolhido pelo `entity_name` da invocação. */
export interface AgentixScenario {
  /** Estados devolvidos a cada consulta (o último se repete). Padrão: QUEUED, RUNNING, DONE. */
  states?: string[];
  messages?: unknown[];
  /** Embrulha as mensagens em `{ messages }` ou `{ items }`. */
  wrap?: 'messages' | 'items';
  errorMessage?: string;
  /** As primeiras `n` consultas respondem 500. */
  pollFailures?: number;
  /** A invocação não devolve `session_id`. */
  noSessionId?: boolean;
}

export interface AgentixMockOptions {
  tls?: boolean;
  apiKey?: string;
  scenarios?: Record<string, AgentixScenario>;
}

export interface AgentixMock {
  origin: string;
  baseUrl: string;
  apiKey: string;
  readonly invokes: Record<string, unknown>[];
  /** Consultas ao estado das sessões. */
  readonly polls: number;
  readonly requests: { method: string; path: string; apiKey: string | undefined }[];
  close(): Promise<void>;
}

export const AGENTIX_MOCK_API_KEY = 'chave-sentinela-agentix-016';

export const AGENTIX_DEFAULT_MESSAGES = [
  { role: 'user', content: 'Qual é a capital do Brasil?' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 't1', function: { name: 'buscar', arguments: '{}' } }],
  },
  { role: 'tool', content: 'Brasília' },
  { role: 'assistant', content: 'A capital do Brasil é Brasília.' },
];

export async function startAgentixMock(options: AgentixMockOptions = {}): Promise<AgentixMock> {
  const apiKey = options.apiKey ?? AGENTIX_MOCK_API_KEY;
  const invokes: Record<string, unknown>[] = [];
  const requests: AgentixMock['requests'] = [];
  const sessions = new Map<string, { scenario: AgentixScenario; polls: number; name: string }>();
  let polls = 0;

  const { server, origin } = await listen(options.tls ?? false, (req, body) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const key = req.headers['x-api-key'];
    const keyValue = Array.isArray(key) ? key[0] : key;
    requests.push({ method: req.method ?? 'GET', path, apiKey: keyValue });
    if (keyValue !== apiKey) return { status: 401, json: { detail: 'Chave de API inválida' } };

    if (req.method === 'POST' && path === '/agentix/v1/sessions/invoke') {
      const data = parse(body);
      invokes.push(data);
      const name = String(data.entity_name);
      const scenario = options.scenarios?.[name] ?? {};
      if (scenario.noSessionId) return { status: 200, json: { state: 'QUEUED' } };
      const id = `sessao-${String(invokes.length)}`;
      sessions.set(id, { scenario, polls: 0, name });
      return { status: 201, json: { session_id: id, state: 'QUEUED' } };
    }
    const match = /^\/agentix\/v1\/sessions\/([^/]+)(\/messages)?$/.exec(path);
    const session = match?.[1] ? sessions.get(decodeURIComponent(match[1])) : undefined;
    if (req.method === 'GET' && match?.[1] && session) {
      const id = decodeURIComponent(match[1]);
      const { scenario } = session;
      if (match[2]) {
        const messages = scenario.messages ?? AGENTIX_DEFAULT_MESSAGES;
        return {
          status: 200,
          json: scenario.wrap ? { [scenario.wrap]: messages } : messages,
        };
      }
      polls += 1;
      session.polls += 1;
      if (session.polls <= (scenario.pollFailures ?? 0)) {
        return { status: 500, json: { detail: 'Falha temporária' } };
      }
      const states = scenario.states ?? ['QUEUED', 'RUNNING', 'DONE'];
      const state =
        states[Math.min(session.polls - 1 - (scenario.pollFailures ?? 0), states.length - 1)];
      return {
        status: 200,
        json: {
          session_id: id,
          state,
          entity_name: session.name,
          token_usage: { input_tokens: 30, output_tokens: 12 },
          ...(scenario.errorMessage && { error_message: scenario.errorMessage }),
        },
      };
    }
    return { status: 404, json: { detail: `Rota inexistente: ${path}` } };
  });

  return {
    origin,
    baseUrl: `${origin}/agentix/v1`,
    apiKey,
    invokes,
    get polls() {
      return polls;
    },
    requests,
    close: () => close(server),
  };
}
