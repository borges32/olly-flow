import type { Item } from '@olly/shared-types';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { ResolvedCredential } from '../../credentials/definitions.js';
import { NodeExecutionError, NodeParameterError } from '../../errors.js';
import {
  createHttpGuard,
  type GuardedRequestInit,
  type HttpGuard,
} from '../../shared/http-guard.js';
import { fakeContext } from '../../test-support/context.js';
import {
  AGENTIX_EXAMPLE_MESSAGES,
  startAgentixMock,
  type AgentixMock,
  type AgentixMockOptions,
} from '../testing/service-mocks.js';
import { createAgentixNode, extractMessages } from './definition.js';

// Os serviços simulados ficam em 127.0.0.1: nos testes, o loopback entra na allowlist.
const realGuard = createHttpGuard({ allowlist: ['127.0.0.1'] });
afterAll(() => realGuard.close());
const calls: GuardedRequestInit[] = [];
const guard: HttpGuard = {
  ...realGuard,
  fetch: (url, init = {}) => {
    calls.push(init);
    return realGuard.fetch(url, init);
  },
};
const node = createAgentixNode({ guard, maxResponseBytes: 1024 * 1024 });

let mock: AgentixMock | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
  calls.length = 0;
});

const credentialFor = (m: AgentixMock, data: Record<string, unknown> = {}): ResolvedCredential => ({
  id: 'cred-agentix',
  type: 'agentixApi',
  updatedAt: '',
  data: { baseUrl: `${m.baseUrl}/`, apiKey: m.apiKey, allowUnauthorizedCerts: false, ...data },
});

const baseParams = {
  entityType: 'agent',
  entityName: 'conversor',
  entityVersion: '0.1.0',
  bundle: 'olly-kb',
  bundleVersion: '0.1.0.dev10',
  payload: '{\n  "pergunta": "Qual é a capital?"\n}',
  constants: '{"idioma": "pt"}',
  waitForCompletion: true,
  output: 'finalAnswer',
  options: { pollIntervalSeconds: 0.1, timeoutSeconds: 10, maxPollErrors: 3 },
};

async function run(
  params: Record<string, unknown> | Record<string, unknown>[] = {},
  options: {
    mock?: AgentixMockOptions;
    items?: Item[];
    onError?: 'continue' | 'errorOutput';
    data?: Record<string, unknown>;
    signal?: AbortSignal;
  } = {},
  /** Ajusta a URL base da credencial (ex.: colada com o endpoint). */
  baseUrl?: (base: string) => string,
) {
  mock = await startAgentixMock(options.mock);
  const data = baseUrl ? { baseUrl: baseUrl(mock.baseUrl), ...options.data } : options.data;
  const merged = Array.isArray(params)
    ? params.map((p) => ({ ...baseParams, ...p }))
    : { ...baseParams, ...params };
  const ctx = fakeContext({
    params: merged,
    credential: credentialFor(mock, data),
    ...(options.signal && { signal: options.signal }),
    ...(options.onError && { node: { settings: { onError: options.onError } } }),
  });
  const items = options.items ?? [{ json: {} }];
  return { output: await node.execute({ inputs: { main: items }, items }, ctx), mock };
}

describe('spec 016 — HU-2: Agentix', () => {
  it('FR-007/FR-009/FR-013: cria a sessão, espera DONE e devolve a resposta final; redes internas pelo filtro', async () => {
    const { output, mock: m } = await run();
    expect(m.invokes).toEqual([
      {
        entity_type: 'agent',
        entity_name: 'conversor',
        entity_version: '0.1.0',
        bundle: 'olly-kb',
        version: '0.1.0.dev10',
        payload: { pergunta: 'Qual é a capital?' },
        constants: { idioma: 'pt' },
      },
    ]);
    expect(output.main).toEqual([
      {
        json: { session_id: 'sessao-1', state: 'DONE', output: 'A capital do Brasil é Brasília.' },
        pairedItem: { item: 0 },
      },
    ]);
    expect(m.polls).toBe(3);
    // FR-008: a chave vai no X-API-Key de todas as chamadas.
    expect(m.requests.map((r) => [r.method, r.path, r.apiKey])).toEqual([
      ['POST', '/v2/api/sessions/invoke', m.apiKey],
      ['GET', '/v2/api/sessions/sessao-1', m.apiKey],
      ['GET', '/v2/api/sessions/sessao-1', m.apiKey],
      ['GET', '/v2/api/sessions/sessao-1', m.apiKey],
      ['GET', '/v2/api/sessions/sessao-1/messages', m.apiKey],
    ]);
    // FR-013: sempre pelo HttpGuard, com as redes internas e o TLS da credencial.
    expect(calls.every((c) => c.allowPrivateNetworks === true && c.insecureTls === false)).toBe(
      true,
    );
  });

  it('FR-009: "todas as mensagens" e os detalhes da sessão', async () => {
    const { output } = await run({
      entityType: 'workflow',
      output: 'allMessages',
      options: { pollIntervalSeconds: 0.1, includeSession: true },
    });
    const json = output.main?.[0]?.json as Record<string, unknown>;
    expect(json.messages).toHaveLength(5);
    expect(json.session).toMatchObject({ state: 'DONE', token_usage: { input_tokens: 30 } });
    expect(mock?.invokes[0]).toMatchObject({ entity_type: 'workflow' });
  });

  it.each(['messages', 'items'] as const)(
    'mensagens embrulhadas em "%s" são aceitas',
    async (wrap) => {
      const { output } = await run({}, { mock: { scenarios: { conversor: { wrap } } } });
      expect(output.main?.[0]?.json).toMatchObject({ output: 'A capital do Brasil é Brasília.' });
    },
  );

  it('FR-007: sem "esperar o fim", devolve a resposta da criação com o session_id', async () => {
    const { output, mock: m } = await run({ waitForCompletion: false });
    // A criação devolve `status` (exemplo da API), repassado como veio.
    expect(output.main?.[0]?.json).toMatchObject({ session_id: 'sessao-1', status: 'QUEUED' });
    expect(m.polls).toBe(0);
  });

  it.each(['FAILED', 'CANCELLED', 'REJECTED'])(
    'FR-010: a sessão em %s faz o item falhar com o estado e a mensagem do Agentix',
    async (state) => {
      const error = await run(
        {},
        {
          mock: {
            scenarios: {
              conversor: { states: ['RUNNING', state], errorMessage: 'motivo do agente' },
            },
          },
        },
      ).catch((e: unknown) => e as Error);
      expect((error as Error).message).toBe(
        `Sessão sessao-1 do Agentix terminou com o estado ${state}: motivo do agente`,
      );
    },
  );

  it('FR-010: o tempo limite configurado no nó cita o último estado', async () => {
    const started = Date.now();
    const error = await run(
      { options: { pollIntervalSeconds: 0.1, timeoutSeconds: 0.35 } },
      { mock: { scenarios: { conversor: { states: ['RUNNING'] } } } },
    ).catch((e: unknown) => e as Error);
    expect((error as Error).message).toContain('Tempo limite esgotado');
    expect((error as Error).message).toContain('último estado: RUNNING');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('falha transitória na consulta é tolerada até o limite; acima dele, o item falha', async () => {
    const tolerated = await run(
      { options: { pollIntervalSeconds: 0.1, maxPollErrors: 2 } },
      { mock: { scenarios: { conversor: { pollFailures: 2 } } } },
    );
    expect(tolerated.output.main?.[0]?.json).toMatchObject({ state: 'DONE' });
    await tolerated.mock.close();

    const error = await run(
      { options: { pollIntervalSeconds: 0.1, maxPollErrors: 1 } },
      { mock: { scenarios: { conversor: { pollFailures: 5 } } } },
    ).catch((e: unknown) => e as Error);
    expect((error as Error).message).toContain('2 erros seguidos');
    expect((error as Error).message).toContain('respondeu 500 (Falha temporária)');
  });

  it('FR-008/FR-014: chave inválida falha com o status, sem expor a chave', async () => {
    const error = await run({}, { data: { apiKey: 'chave-errada-sentinela' } }).catch(
      (e: unknown) => e as Error,
    );
    expect((error as Error).message).toBe(
      `Chamada ao Agentix falhou: POST ${mock?.baseUrl ?? ''}/sessions/invoke respondeu 401 (Chave de API inválida). Confira a chave da API e a URL base da credencial (ex.: https://<host>/v2/api).`,
    );
    expect(JSON.stringify(error)).not.toContain('chave-errada-sentinela');
  });

  // Correções a partir do exemplo da API (prompt/Agentix/exemplo_api_agentix.txt), depois do
  // erro 403 relatado em dev.
  it('FR-008: o 403 mostra o endereço chamado e o motivo devolvido pelo Agentix', async () => {
    const error = await run({}, { data: { apiKey: '' } }).catch((e: unknown) => e as Error);
    // Sem chave, o nó nem chama: a credencial exige a chave.
    expect((error as Error).message).toContain('informe o campo "apiKey"');
    await mock?.close();
    // O simulador responde 403 "Not authenticated" quando o X-API-Key não chega.
    const noKey: HttpGuard = {
      ...guard,
      fetch: (url, init = {}) => {
        const headers = { ...(init.headers as Record<string, string>) };
        delete headers['x-api-key'];
        return realGuard.fetch(url, { ...init, headers });
      },
    };
    mock = await startAgentixMock();
    const ctx = fakeContext({ params: baseParams, credential: credentialFor(mock) });
    const forbidden = await createAgentixNode({ guard: noKey, maxResponseBytes: 1024 * 1024 })
      .execute({ inputs: { main: [{ json: {} }] }, items: [{ json: {} }] }, ctx)
      .catch((e: unknown) => e as Error);
    expect((forbidden as Error).message).toBe(
      `Chamada ao Agentix falhou: POST ${mock.baseUrl}/sessions/invoke respondeu 403 (Not authenticated). Confira a chave da API e a URL base da credencial (ex.: https://<host>/v2/api).`,
    );
  });

  it.each(['/sessions/invoke', '/sessions', '/sessions/invoke/'])(
    'FR-008: URL base colada com o endpoint (%s) é corrigida para a raiz da API',
    async (suffix) => {
      const { output, mock: m } = await run({}, {}, (base) => `${base}${suffix}`);
      expect(output.main?.[0]?.json).toMatchObject({ state: 'DONE' });
      expect(m.requests[0]?.path).toBe('/v2/api/sessions/invoke');
    },
  );

  it('FR-008: o nó se identifica no User-Agent (não envia o "undici" padrão, barrado por WAFs)', async () => {
    const { mock: m } = await run();
    expect(m.requests.map((r) => r.userAgent)).toEqual(
      m.requests.map(() => expect.stringMatching(/^Olly-Flow\//) as unknown),
    );
  });

  it('FR-009: com as mensagens do exemplo da API, a resposta final é o content do último "assistant"', async () => {
    const { output } = await run(
      {},
      { mock: { scenarios: { conversor: { messages: AGENTIX_EXAMPLE_MESSAGES } } } },
    );
    expect(output.main?.[0]?.json).toEqual({
      session_id: 'sessao-1',
      state: 'DONE',
      output: 'Porque o cachorro entrou na igreja? Porque a porta estava aberta',
    });
  });

  it('FR-010: sessão recusada já na criação (status REJECTED) falha sem consultar o estado', async () => {
    const error = await run(
      {},
      {
        mock: {
          scenarios: { conversor: { invokeStatus: 'REJECTED', errorMessage: 'sem permissão' } },
        },
      },
    ).catch((e: unknown) => e as Error);
    expect((error as Error).message).toBe(
      'Sessão sessao-1 do Agentix terminou com o estado REJECTED: sem permissão',
    );
    expect(mock?.polls).toBe(0);
  });

  it('FR-010: error_message nulo não aparece na mensagem; BLOCKED no tempo limite explica a espera', async () => {
    const failed = await run(
      {},
      { mock: { scenarios: { conversor: { states: ['FAILED'] } } } },
    ).catch((e: unknown) => e as Error);
    expect((failed as Error).message).toBe(
      'Sessão sessao-1 do Agentix terminou com o estado FAILED',
    );
    await mock?.close();
    const blocked = await run(
      { options: { pollIntervalSeconds: 0.1, timeoutSeconds: 0.25 } },
      { mock: { scenarios: { conversor: { states: ['BLOCKED'] } } } },
    ).catch((e: unknown) => e as Error);
    expect((blocked as Error).message).toContain('último estado: BLOCKED');
    expect((blocked as NodeExecutionError).details.description).toContain(
      'aguardando uma interação',
    );
  });

  it('Agentix sem session_id e sessão DONE sem mensagem "assistant" geram erro no item', async () => {
    const noId = await run({}, { mock: { scenarios: { conversor: { noSessionId: true } } } }).catch(
      (e: unknown) => e as Error,
    );
    expect((noId as Error).message).toContain('não devolveu o session_id');
    await mock?.close();
    const noAnswer = await run(
      {},
      { mock: { scenarios: { conversor: { messages: [{ role: 'user', content: 'oi' }] } } } },
    ).catch((e: unknown) => e as Error);
    expect((noAnswer as Error).message).toContain('sem uma mensagem "assistant"');
  });

  it('payload e constantes: objeto de expressão aceito; JSON inválido ou lista geram erro com o parâmetro', async () => {
    const fromExpression = await run({ payload: { pergunta: 'via expressão' }, constants: '' });
    expect(fromExpression.mock.invokes[0]).toMatchObject({
      payload: { pergunta: 'via expressão' },
      constants: {},
    });
    await fromExpression.mock.close();
    const invalid = await run({ payload: '{ quebrado' }).catch((e: unknown) => e as Error);
    expect(invalid).toBeInstanceOf(NodeParameterError);
    expect((invalid as Error).message).toContain('Parâmetro "payload"');
    await mock?.close();
    const list = await run({ constants: '[1, 2]' }).catch((e: unknown) => e as Error);
    expect((list as Error).message).toContain('Parâmetro "constants": deve ser um objeto JSON');
  });

  const threeItems: Item[] = [{ json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 3 } }];
  const perItem = [{ entityName: 'ok' }, { entityName: 'falha' }, { entityName: 'ok' }];
  const failing: AgentixMockOptions = {
    scenarios: { falha: { states: ['FAILED'], errorMessage: 'quebrou' } },
  };

  it('FR-010: com "continuar", cada item invoca uma sessão e o que falha vira item de erro', async () => {
    const { output, mock: m } = await run(perItem, {
      items: threeItems,
      onError: 'continue',
      mock: failing,
    });
    expect(m.invokes).toHaveLength(3);
    expect(output.main?.map((i) => i.pairedItem)).toEqual([{ item: 0 }, { item: 1 }, { item: 2 }]);
    expect(output.main?.[1]?.json).toEqual({
      error: expect.objectContaining({
        message: 'Sessão sessao-2 do Agentix terminou com o estado FAILED: quebrou',
      }) as unknown,
    });
    expect(output.main?.[2]?.json).toMatchObject({ state: 'DONE' });
  });

  it('FR-010: com "saída de erro", o item que falha vai para a porta error; com "parar", o nó falha', async () => {
    const { output } = await run(perItem, {
      items: threeItems,
      onError: 'errorOutput',
      mock: failing,
    });
    expect(output.main).toHaveLength(2);
    expect(output.error).toEqual([
      expect.objectContaining({
        json: expect.objectContaining({ n: 2 }) as unknown,
        pairedItem: { item: 1 },
      }),
    ]);
    await mock?.close();
    await expect(run(perItem, { items: threeItems, mock: failing })).rejects.toThrow('FAILED');
  });

  it('FR-011: o cancelamento interrompe a espera na hora', async () => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(new Error('Execução cancelada pelo usuário'));
    }, 150);
    const started = Date.now();
    await expect(
      run(
        { options: { pollIntervalSeconds: 30, timeoutSeconds: 0 } },
        {
          mock: { scenarios: { conversor: { states: ['RUNNING'] } } },
          signal: controller.signal,
          onError: 'continue',
        },
      ),
    ).rejects.toThrow('cancelada');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('FR-008: certificado autoassinado só funciona com "não verificar o certificado"', async () => {
    const insecure = await run({}, { mock: { tls: true }, data: { allowUnauthorizedCerts: true } });
    expect(insecure.output.main?.[0]?.json).toMatchObject({ state: 'DONE' });
    expect(calls.every((c) => c.insecureTls === true)).toBe(true);
    await insecure.mock.close();
    await expect(run({}, { mock: { tls: true } })).rejects.toThrow();
  });

  it('extractMessages aceita lista pura e embrulhada; outros formatos viram lista vazia', () => {
    expect(extractMessages([{ role: 'a' }])).toHaveLength(1);
    expect(extractMessages({ items: [{ role: 'a' }, 'x'] })).toHaveLength(1);
    expect(extractMessages('nada')).toEqual([]);
  });
});
