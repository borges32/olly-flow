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
  /** Modelos sem permissão para o usuário de serviço: respondem 403 com uma mensagem. */
  forbiddenModels?: string[];
}

export interface BridgeMockCall {
  model: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
  /** Cabeçalhos recebidos (nomes em minúsculas). */
  headers: Record<string, string | string[] | undefined>;
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
  /** Cabeçalhos de cada login recebido. */
  readonly loginHeaders: Record<string, string | string[] | undefined>[];
  /** Tokens emitidos (para a busca por sentinelas). */
  readonly tokens: string[];
  /** As próximas `n` chamadas ao modelo respondem 401 (ou o status pedido), como um token recusado. */
  rejectNextCalls(n: number, status?: number): void;
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
  const loginHeaders: BridgeMock['loginHeaders'] = [];
  let logins = 0;
  let reject = 0;
  let rejectStatus = 401;

  const login = async (req: IncomingMessage, body: string): Promise<MockResponse> => {
    loginHeaders.push(req.headers);
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
    // Formato do exemplo da Bridge (prompt "Prompt N8N.md").
    return {
      status: 200,
      json: {
        nome: '278 - AIOps operator',
        email: 'servico@exemplo.local',
        token,
        projeto_perfil: {
          project: { id: 'p1', codigo: 'CD_PLATAFORM_278', descricao: '278 - AIOps operator' },
          perfil: { id: 'u1', status: 'ACTIVE', codigo: 'USUARIO', descricao: 'Usuário' },
        },
      },
    };
  };

  const chat = (req: IncomingMessage, model: string, body: string): MockResponse => {
    const authorization = req.headers.authorization;
    const data = parse(body);
    calls.push({ model, authorization, body: data, headers: req.headers });
    const token = authorization?.replace(/^Bearer /, '') ?? '';
    if (reject > 0 || !valid.has(token)) {
      const status = reject > 0 ? rejectStatus : 401;
      reject = Math.max(0, reject - 1);
      return { status, json: { mensagem: 'Token inválido ou expirado' } };
    }
    if (options.forbiddenModels?.includes(model)) {
      return {
        status: 403,
        json: { mensagem: `Modelo ${model} não liberado para o projeto CD_PLATAFORM_278` },
      };
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
            // Campos extras e nulos como no exemplo da Bridge.
            message: {
              content: step.content ?? null,
              role: 'assistant',
              tool_calls:
                toolCalls.length > 0
                  ? toolCalls.map((call) =>
                      Object.fromEntries(Object.entries(call).filter(([k]) => k !== 'index')),
                    )
                  : null,
              function_call: null,
              images: [],
              thinking_blocks: [],
              provider_specific_fields: null,
            },
            finish_reason: finish,
          },
        ],
        system_fingerprint: null,
        usage: {
          ...usageBody,
          completion_tokens_details: { reasoning_tokens: 0, text_tokens: usage.completion_tokens },
          prompt_tokens_details: { cached_tokens: null, text_tokens: usage.prompt_tokens },
        },
        vertex_ai_grounding_metadata: [],
      },
    };
  };

  const { server, origin } = await listen(options.tls ?? false, (req, body) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (req.method === 'POST' && path === '/iagen-identity/v1/usuarios/login-servico')
      return login(req, body);
    const match = /^\/iagen-llm-proxy\/v1\/deployments\/([^/]+)\/chat\/completions$/.exec(path);
    if (req.method === 'POST' && match?.[1]) return chat(req, decodeURIComponent(match[1]), body);
    return { status: 404, json: { mensagem: `Rota inexistente: ${path}` } };
  });

  return {
    origin,
    tokenUrl: `${origin}/iagen-identity/v1/usuarios/login-servico`,
    baseUrl: `${origin}/iagen-llm-proxy/v1`,
    identificador,
    senha,
    get logins() {
      return logins;
    },
    calls,
    loginHeaders,
    tokens,
    rejectNextCalls: (n, status = 401) => {
      reject = n;
      rejectStatus = status;
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
  /** `status` devolvido já na criação (padrão `QUEUED`; ex.: `REJECTED`). */
  invokeStatus?: string;
}

export interface AgentixMockOptions {
  tls?: boolean;
  apiKey?: string;
  scenarios?: Record<string, AgentixScenario>;
}

export interface AgentixMockRequest {
  method: string;
  path: string;
  apiKey: string | undefined;
  userAgent: string | undefined;
}

export interface AgentixMock {
  origin: string;
  /** Como na API real: `<origem>/v2/api`. */
  baseUrl: string;
  apiKey: string;
  readonly invokes: Record<string, unknown>[];
  /** Consultas ao estado das sessões. */
  readonly polls: number;
  readonly requests: AgentixMockRequest[];
  close(): Promise<void>;
}

export const AGENTIX_MOCK_API_KEY = 'chave-sentinela-agentix-016';

/** Mensagens com uma chamada de ferramenta intermediária (no formato do exemplo da API). */
export const AGENTIX_DEFAULT_MESSAGES = [
  { role: 'system', content: '', tool_calls: null, tool_call_id: null, tool_name: null },
  { role: 'user', content: "{'pergunta': 'Qual é a capital do Brasil?'}", tool_calls: null },
  {
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 't1', function: { name: 'buscar', arguments: '{}' } }],
  },
  { role: 'tool', content: 'Brasília', tool_call_id: 't1', tool_name: 'buscar' },
  { role: 'assistant', content: 'A capital do Brasil é Brasília.', tool_calls: null },
];

/** Resposta de `sessions/{id}/messages` do exemplo da API do Agentix (prompt/Agentix). */
export const AGENTIX_EXAMPLE_MESSAGES = [
  {
    role: 'system',
    content: '',
    tool_calls: null,
    tool_call_id: null,
    tool_name: null,
    run_id: '568ea34d-68a9-42c7-b03d-ee8f2fdc37be',
    created_at: 1790366234,
  },
  {
    role: 'user',
    content: "{'pergunta': 'Conte uma piada engraçada'}",
    tool_calls: null,
    tool_call_id: null,
    tool_name: null,
    run_id: '568ea34d-68a9-42c7-b03d-ee8f2fdc37be',
    created_at: 1790366234,
  },
  {
    role: 'assistant',
    content: 'Porque o cachorro entrou na igreja? Porque a porta estava aberta',
    tool_calls: null,
    tool_call_id: null,
    tool_name: null,
    run_id: '568ea34d-68a9-42c7-b03d-ee8f2fdc37be',
    created_at: 1790366234,
  },
];

/**
 * Agentix simulado no formato do exemplo da API (`prompt/Agentix/exemplo_api_agentix.txt`): a
 * criação devolve `status`; a consulta, `state` e os demais campos (nulos quando vazios). Sem o
 * cabeçalho `X-API-Key`, responde 403 `Not authenticated` (como o `APIKeyHeader` do FastAPI);
 * com a chave errada, 401.
 */
export async function startAgentixMock(options: AgentixMockOptions = {}): Promise<AgentixMock> {
  const apiKey = options.apiKey ?? AGENTIX_MOCK_API_KEY;
  const invokes: Record<string, unknown>[] = [];
  const requests: AgentixMockRequest[] = [];
  const sessions = new Map<
    string,
    { scenario: AgentixScenario; polls: number; invoke: Record<string, unknown> }
  >();
  let polls = 0;

  const { server, origin } = await listen(options.tls ?? false, (req, body) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const key = req.headers['x-api-key'];
    const keyValue = Array.isArray(key) ? key[0] : key;
    requests.push({
      method: req.method ?? 'GET',
      path,
      apiKey: keyValue,
      userAgent: req.headers['user-agent'],
    });
    if (keyValue === undefined) return { status: 403, json: { detail: 'Not authenticated' } };
    if (keyValue !== apiKey) return { status: 401, json: { detail: 'Chave de API inválida' } };

    if (req.method === 'POST' && path === '/v2/api/sessions/invoke') {
      const data = parse(body);
      invokes.push(data);
      const scenario = options.scenarios?.[String(data.entity_name)] ?? {};
      const id = `sessao-${String(invokes.length)}`;
      const invoke = {
        session_id: id,
        status: scenario.invokeStatus ?? 'QUEUED',
        component: `${String(data.entity_type)}/${String(data.entity_name)}@${String(data.entity_version)}`,
        tenant_id: 'AMON',
        bundle_version: data.version,
        bundle_content_hash: 'sha256:eeda7d91',
        ...(scenario.invokeStatus &&
          scenario.errorMessage && { error_message: scenario.errorMessage }),
      };
      if (scenario.noSessionId) {
        return {
          status: 200,
          json: Object.fromEntries(Object.entries(invoke).filter(([k]) => k !== 'session_id')),
        };
      }
      sessions.set(id, { scenario, polls: 0, invoke: data });
      return { status: 201, json: invoke };
    }
    const match = /^\/v2\/api\/sessions\/([^/]+)(\/messages)?$/.exec(path);
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
          tenant_id: 'AMON',
          entity_type: String(session.invoke.entity_type).toUpperCase(),
          entity_name: session.invoke.entity_name,
          entity_version: session.invoke.entity_version,
          bundle_name: session.invoke.bundle,
          bundle_version: session.invoke.version,
          state,
          created_at: '2026-09-25T19:57:06.114820+00:00',
          updated_at: '2026-09-25T19:57:26.641774+00:00',
          partial_output: null,
          error_message: scenario.errorMessage ?? null,
          summary: null,
          stages: [],
          token_usage: state === 'DONE' ? { input_tokens: 30, output_tokens: 12 } : null,
          triggered_by: 'f936245',
          feedback: null,
        },
      };
    }
    return { status: 404, json: { detail: 'Not Found' } };
  });

  return {
    origin,
    baseUrl: `${origin}/v2/api`,
    apiKey,
    invokes,
    get polls() {
      return polls;
    },
    requests,
    close: () => close(server),
  };
}
