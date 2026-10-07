import type { AIMessage } from '@langchain/core/messages';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedCredential } from '../../credentials/definitions.js';
import { CredentialTypeRegistry } from '../../credentials/registry.js';
import { CredentialTestInputError, testCredential } from '../../credentials/test.js';
import { createHttpGuard } from '../../shared/http-guard.js';
import { fakeContext } from '../../test-support/context.js';
import {
  startBridgeMock,
  type BridgeMock,
  type BridgeMockOptions,
} from '../testing/service-mocks.js';
import type { AiFetchOptions, AiGateway, ChatModelSupply } from '../runtime/types.js';
import { contentText } from '../runtime/agent.js';
import { createBridgeChatModelNode } from './definition.js';
import { BridgeTokenManager } from './token-manager.js';

// Os serviços simulados ficam em 127.0.0.1: nos testes, o loopback entra na allowlist.
const guard = createHttpGuard({ allowlist: ['127.0.0.1'] });
afterAll(() => guard.close());

let mock: BridgeMock | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

function gateway() {
  const fetchOptions: AiFetchOptions[] = [];
  const ai: AiGateway = {
    checkModel: vi.fn(() => Promise.reject(new Error('a Bridge não consulta a lista'))),
    beforeModelCall: () => Promise.resolve(),
    recordUsage: () => Promise.resolve(),
    recordStep: () => Promise.resolve(),
    persistentMemory: () => ({ load: () => Promise.resolve([]), append: () => Promise.resolve() }),
    executionMemory: () => ({ load: () => Promise.resolve([]), append: () => Promise.resolve() }),
    fetch,
    fetchFor: (options) => {
      fetchOptions.push(options);
      return ((url: string | URL, init: RequestInit = {}) =>
        guard.fetch(url, { ...init, ...options } as Parameters<
          typeof guard.fetch
        >[1])) as unknown as typeof fetch;
    },
    limits: { maxIterations: 10, toolResultMaxChars: 1000 },
    allowFakeModel: false,
  };
  return { ai, fetchOptions };
}

const credentialFor = (m: BridgeMock, data: Record<string, unknown> = {}): ResolvedCredential => ({
  id: 'cred-bridge',
  type: 'bridgeApi',
  updatedAt: String(Math.random()),
  data: {
    tokenUrl: m.tokenUrl,
    baseUrl: `${m.baseUrl}/`,
    identificador: m.identificador,
    senha: m.senha,
    tokenSkewSeconds: 60,
    allowUnauthorizedCerts: false,
    ...data,
  },
});

async function supply(
  params: Record<string, unknown>,
  mockOptions: BridgeMockOptions = {},
  data: Record<string, unknown> = {},
) {
  mock = await startBridgeMock(mockOptions);
  const { ai, fetchOptions } = gateway();
  const ctx = fakeContext({ params, credential: credentialFor(mock, data), ai });
  const node = createBridgeChatModelNode({ tokens: new BridgeTokenManager() });
  const supplied = (await node.supplyData?.(ctx, 0)) as ChatModelSupply;
  return { supplied, ctx, ai, fetchOptions, mock };
}

describe('spec 016 — HU-1: Bridge Chat Model', () => {
  it('FR-001/FR-003/FR-006/FR-013/FR-014: modelo no endereço, token Bearer, sem "model" no corpo, sem lista de modelos, redes internas e token mascarado', async () => {
    const {
      supplied,
      ctx,
      ai,
      fetchOptions,
      mock: m,
    } = await supply(
      { model: 'gemini-2.5-flash', stream: false, options: { maxRetries: 0 } },
      { script: [{ content: 'Olá da Bridge' }] },
    );
    expect(supplied).toMatchObject({ provider: 'bridge', model: 'gemini-2.5-flash' });
    // FR-006: a lista de modelos (Administração › IA) não é consultada.
    expect(ai.checkModel).not.toHaveBeenCalled();
    // FR-013: as chamadas pedem as redes internas, com o TLS da credencial.
    expect(fetchOptions).toEqual([{ insecureTls: false, allowPrivateNetworks: true }]);

    const response = (await supplied.chatModel.invoke('oi')) as AIMessage;
    expect(contentText(response)).toBe('Olá da Bridge');
    expect(response.usage_metadata).toMatchObject({ input_tokens: 12, output_tokens: 7 });
    expect(m.calls).toHaveLength(1);
    const [call] = m.calls;
    expect(call?.model).toBe('gemini-2.5-flash');
    expect(call?.authorization).toBe(`Bearer ${m.tokens[0] ?? ''}`);
    expect(call?.body).not.toHaveProperty('model');
    expect(m.logins).toBe(1);
    // FR-014: o token obtido entra no mascaramento da execução.
    expect(ctx.secrets).toContain(m.tokens[0]);
  });

  it('FR-001: streaming ligado por padrão; o uso de tokens só é pedido com a opção', async () => {
    const plain = await supply(
      { model: 'gpt-4', options: { maxRetries: 0 } },
      { script: [{ content: 'parte' }] },
    );
    const streamed = (await plain.supplied.chatModel.invoke('oi')) as AIMessage;
    expect(contentText(streamed)).toBe('parte');
    expect(plain.mock.calls[0]?.body).toMatchObject({ stream: true });
    expect(plain.mock.calls[0]?.body).not.toHaveProperty('stream_options');
    await plain.mock.close();

    const withUsage = await supply(
      { model: 'gpt-4', stream: true, options: { streamUsage: true, maxRetries: 0 } },
      { script: [{ content: 'com uso' }] },
    );
    const response = (await withUsage.supplied.chatModel.invoke('oi')) as AIMessage;
    expect(withUsage.mock.calls[0]?.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(response.usage_metadata).toMatchObject({ input_tokens: 12, output_tokens: 7 });
  });

  it('FR-001: as opções vão no corpo; "enviar o modelo no corpo" inclui o model', async () => {
    const { supplied, mock: m } = await supply({
      model: 'gemini-2.5-flash',
      stream: false,
      options: {
        temperature: 0.2,
        topP: 0.9,
        maxTokens: 300,
        n: 2,
        stop: 'FIM, PARE',
        user: 'usuario-1',
        sendModelInBody: true,
        maxRetries: 0,
      },
    });
    await supplied.chatModel.invoke('oi');
    expect(m.calls[0]?.body).toMatchObject({
      model: 'gemini-2.5-flash',
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 300,
      n: 2,
      stop: ['FIM', 'PARE'],
      user: 'usuario-1',
    });
  });

  it('FR-001: chamadas de ferramenta chegam ao Agent (com streaming)', async () => {
    const { supplied } = await supply(
      { model: 'gpt-4', options: { maxRetries: 0 } },
      { script: [{ toolCalls: [{ name: 'buscar_cep', args: { cep: '01001000' } }] }] },
    );
    const bound = supplied.chatModel.bindTools?.([
      {
        type: 'function',
        function: {
          name: 'buscar_cep',
          description: 'Busca um CEP',
          parameters: { type: 'object', properties: { cep: { type: 'string' } } },
        },
      },
    ]);
    const response = (await bound?.invoke('qual o endereço do CEP 01001000?')) as AIMessage;
    expect(response.tool_calls).toEqual([
      expect.objectContaining({ name: 'buscar_cep', args: { cep: '01001000' } }),
    ]);
  });

  it('FR-005: token recusado (401) faz um novo login e repete a chamada uma vez', async () => {
    const { supplied, mock: m } = await supply({
      model: 'gpt-4',
      stream: false,
      options: { maxRetries: 0 },
    });
    await supplied.chatModel.invoke('primeira');
    m.expireTokens(); // o token venceu no servidor: a próxima chamada recebe 401
    const response = (await supplied.chatModel.invoke('segunda')) as AIMessage;
    expect(contentText(response)).toBe('ok');
    expect(m.logins).toBe(2);
    expect(m.calls).toHaveLength(3);
    expect(m.calls[2]?.authorization).toBe(`Bearer ${m.tokens[1] ?? ''}`);
  });

  it('FR-005: um segundo 401 seguido não gera novas tentativas além da repetição única', async () => {
    const { supplied, mock: m } = await supply({
      model: 'gpt-4',
      stream: false,
      options: { maxRetries: 0 },
    });
    m.rejectNextCalls(2);
    await expect(supplied.chatModel.invoke('oi')).rejects.toThrow();
    expect(m.calls).toHaveLength(2);
    expect(m.logins).toBe(2);
  });

  it('FR-002: certificado autoassinado só funciona com "não verificar o certificado"', async () => {
    const insecure = await supply(
      { model: 'gpt-4', stream: false, options: { maxRetries: 0 } },
      { tls: true, script: [{ content: 'via https' }] },
      { allowUnauthorizedCerts: true },
    );
    expect(insecure.fetchOptions).toEqual([{ insecureTls: true, allowPrivateNetworks: true }]);
    expect(contentText((await insecure.supplied.chatModel.invoke('oi')) as AIMessage)).toBe(
      'via https',
    );
    await insecure.mock.close();

    const strict = await supply(
      { model: 'gpt-4', stream: false, options: { maxRetries: 0 } },
      { tls: true },
    );
    await expect(strict.supplied.chatModel.invoke('oi')).rejects.toThrow();
    expect(strict.mock.logins).toBe(0);
  });

  it('modelo inexistente: o erro da Bridge (404) volta na execução', async () => {
    const { supplied } = await supply(
      { model: 'nao-existe', stream: false, options: { maxRetries: 0 } },
      { script: [{ status: 404 }] },
    );
    await expect(supplied.chatModel.invoke('oi')).rejects.toThrow(/404/);
  });

  it('FR-001: modelo vazio e credencial de outro tipo são recusados', async () => {
    mock = await startBridgeMock();
    const { ai } = gateway();
    const node = createBridgeChatModelNode();
    await expect(
      node.supplyData?.(
        fakeContext({ params: { model: '  ' }, credential: credentialFor(mock), ai }),
        0,
      ),
    ).rejects.toThrow('informe o modelo');
    await expect(
      node.supplyData?.(
        fakeContext({
          params: { model: 'gpt-4' },
          credential: { id: 'x', type: 'openAiCompatible', data: {}, updatedAt: '' },
          ai,
        }),
        0,
      ),
    ).rejects.toThrow('não serve para a Bridge');
    // Sub-nó: não executa no fluxo.
    await expect(
      node.execute({ inputs: {}, items: [] }, fakeContext({ params: {} })),
    ).rejects.toThrow('sub-nó');
  });
});

// Correções a partir do exemplo da Bridge (prompt "Prompt N8N.md"), depois do erro 403 em dev.
describe('spec 016 — HU-1: chamada igual ao exemplo da Bridge (erro 403 em dev)', () => {
  it('FR-003: só os cabeçalhos do exemplo, com o User-Agent da plataforma (sem x-stainless nem o agente do SDK)', async () => {
    const { supplied, mock: m } = await supply({
      model: 'gemini-2.5-flash',
      stream: false,
      options: { maxRetries: 0 },
    });
    await supplied.chatModel.invoke('oi');
    const headers = m.calls[0]?.headers ?? {};
    expect(Object.keys(headers).filter((h) => h.startsWith('x-stainless'))).toEqual([]);
    expect(headers['user-agent']).toMatch(/^Olly-Flow\//);
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toMatch(/^Bearer /);
    // O login também se identifica (o fetch mandaria "undici").
    expect(m.loginHeaders[0]?.['user-agent']).toMatch(/^Olly-Flow\//);
    // Corpo como no curl do exemplo: mensagens, sem "model".
    expect(m.calls[0]?.body).toEqual({
      stream: false,
      messages: [{ role: 'user', content: 'oi' }],
    });
  });

  it('FR-001: resposta no formato da Bridge (images, thinking_blocks) chega ao Agent como texto', async () => {
    const { supplied } = await supply(
      { model: 'gemini-2.5-flash', stream: false, options: { maxRetries: 0 } },
      { script: [{ content: 'Três títulos' }] },
    );
    const response = (await supplied.chatModel.invoke('oi')) as AIMessage;
    // Com `images: []` na resposta, o LangChain entrega o conteúdo em blocos.
    expect(response.content).toEqual([
      expect.objectContaining({ type: 'text', text: 'Três títulos' }),
    ]);
    // O Agent junta os blocos de texto (antes, a resposta final saía como JSON dos blocos).
    expect(contentText(response)).toBe('Três títulos');
  });

  it.each(['/deployments/gemini-2.5-flash/chat/completions', '/deployments', '/chat/completions'])(
    'FR-003: URL base colada com o endpoint (%s) é corrigida para a raiz do proxy',
    async (suffix) => {
      mock = await startBridgeMock();
      const { ai } = gateway();
      const ctx = fakeContext({
        params: { model: 'gemini-2.5-flash', stream: false, options: { maxRetries: 0 } },
        credential: credentialFor(mock, { baseUrl: `${mock.baseUrl}${suffix}` }),
        ai,
      });
      const node = createBridgeChatModelNode({ tokens: new BridgeTokenManager() });
      const model = ((await node.supplyData?.(ctx, 0)) as ChatModelSupply).chatModel;
      expect(contentText((await model.invoke('oi')) as AIMessage)).toBe('ok');
      expect(mock.calls[0]?.model).toBe('gemini-2.5-flash');
    },
  );

  it('FR-005: 403 persistente mostra o endereço, o modelo e o motivo devolvido pela Bridge', async () => {
    const { supplied, mock: m } = await supply(
      { model: 'gpt-4', stream: false, options: { maxRetries: 0 } },
      { forbiddenModels: ['gpt-4'] },
    );
    const error = await supplied.chatModel.invoke('oi').catch((e: unknown) => e as Error);
    const message = (error as Error).message;
    expect(message).toContain('A Bridge recusou a chamada (403)');
    expect(message).toContain(`${m.baseUrl}/deployments/gpt-4/chat/completions`);
    expect(message).toContain('Modelo gpt-4 não liberado para o projeto CD_PLATAFORM_278');
    expect(message).toContain('alias');
    // Um novo login e uma única repetição, como no 401.
    expect(m.calls).toHaveLength(2);
    expect(m.logins).toBe(2);
    expect(message).not.toContain(m.tokens[0] ?? 'sem-token');
  });

  it('FR-005: um 403 só na primeira chamada (token recusado) é resolvido pelo novo login', async () => {
    const { supplied, mock: m } = await supply({
      model: 'gpt-4',
      stream: false,
      options: { maxRetries: 0 },
    });
    m.rejectNextCalls(1, 403);
    expect(contentText((await supplied.chatModel.invoke('oi')) as AIMessage)).toBe('ok');
    expect(m.logins).toBe(2);
  });
});

describe('spec 016 — FR-002/FR-008: credenciais Bridge e Agentix', () => {
  const registry = new CredentialTypeRegistry();

  it('FR-002/FR-008: endereços obrigatórios e sem valor padrão; TLS verificado por padrão', () => {
    const bridge = registry.validate('bridgeApi', { identificador: 'svc', senha: 's' });
    expect(bridge.ok).toBe(false);
    if (!bridge.ok) expect(bridge.problems.join(' ')).toMatch(/tokenUrl.*|baseUrl.*/);
    const ok = registry.validate('bridgeApi', {
      tokenUrl: 'https://bridge.interna/login',
      baseUrl: 'https://bridge.interna/v1',
      identificador: 'svc',
      senha: 's',
    });
    expect(ok.ok && ok.data).toMatchObject({ tokenSkewSeconds: 60, allowUnauthorizedCerts: false });
    expect(registry.validate('agentixApi', { apiKey: 'k' }).ok).toBe(false);
    const agentix = registry.validate('agentixApi', {
      baseUrl: 'https://agentix.interna/v1',
      apiKey: 'k',
    });
    expect(agentix.ok && agentix.data).toMatchObject({ allowUnauthorizedCerts: false });
    for (const type of ['bridgeApi', 'agentixApi']) {
      const props = registry.get(type)?.properties.properties ?? {};
      for (const field of ['tokenUrl', 'baseUrl']) {
        expect((props[field] as { default?: unknown } | undefined)?.default).toBeUndefined();
      }
    }
    // FR-014: senha e chave são campos secretos.
    expect(registry.secretFields('bridgeApi')).toEqual(['senha']);
    expect(registry.secretFields('agentixApi')).toEqual(['apiKey']);
  });

  it('FR-002: "Testar" faz o mesmo login da execução, sem expor a senha', async () => {
    mock = await startBridgeMock();
    await expect(testCredential(credentialFor(mock), { guard })).resolves.toEqual({
      ok: true,
      message: 'Login bem-sucedido',
    });
    const wrong = await testCredential(credentialFor(mock, { senha: 'senha-errada-016' }), {
      guard,
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.message).toContain('401');
    expect(wrong.message).not.toContain('senha-errada-016');
    expect(mock.logins).toBe(1);
  });

  it('FR-008: a credencial Agentix é validada na primeira execução (sem endpoint de teste)', async () => {
    await expect(
      testCredential(
        { id: 'a', type: 'agentixApi', updatedAt: '', data: { baseUrl: 'https://x', apiKey: 'k' } },
        { guard },
      ),
    ).rejects.toBeInstanceOf(CredentialTestInputError);
  });
});
