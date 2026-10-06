import type { ChatOpenAI } from '@langchain/openai';
import { describe, expect, it, vi } from 'vitest';
import { fakeContext } from '../../test-support/context.js';
import type { AiGateway, ChatModelSupply } from '../runtime/types.js';
import { chatModelNode } from './definition.js';

const gateway = (allowFakeModel: boolean): AiGateway => ({
  checkModel: vi.fn(() => Promise.resolve()),
  beforeModelCall: () => Promise.resolve(),
  recordUsage: () => Promise.resolve(),
  recordStep: () => Promise.resolve(),
  persistentMemory: () => ({ load: () => Promise.resolve([]), append: () => Promise.resolve() }),
  executionMemory: () => ({ load: () => Promise.resolve([]), append: () => Promise.resolve() }),
  fetch,
  limits: { maxIterations: 10, toolResultMaxChars: 1000 },
  allowFakeModel,
});

const supply = (ai: AiGateway) =>
  chatModelNode.supplyData?.(
    fakeContext({
      params: { model: 'fake-model' },
      credential: {
        id: 'c',
        type: 'fakeLlm',
        data: { script: JSON.stringify([{ content: 'oi' }]) },
        updatedAt: '',
      },
      ai,
    }),
    0,
  );

describe('spec 011 — FR-016/FR-002: modelo simulado e lista permitida', () => {
  it('FR-016: o modelo simulado só é aceito em testes (NODE_ENV=test)', async () => {
    await expect(supply(gateway(false))).rejects.toThrow('só é aceito em testes');
    const ai = gateway(true);
    await expect(supply(ai)).resolves.toMatchObject({ provider: 'fake', model: 'fake-model' });
    // FR-002: o modelo passa pela lista permitida antes de ser instanciado.
    expect(ai.checkModel).toHaveBeenCalledWith({ provider: 'fake', model: 'fake-model' });
  });
});

/** Parâmetros que o modelo OpenAI enviaria ao provedor (sem chamar a rede). */
async function openAiParams(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const supplied = await chatModelNode.supplyData?.(
    fakeContext({
      params: { model: 'gpt-5-mini', ...params },
      credential: {
        id: 'c',
        type: 'openAiCompatible',
        data: { apiKey: 'sk-teste' },
        updatedAt: '',
      },
      ai: gateway(false),
    }),
    0,
  );
  const model = (supplied as ChatModelSupply).chatModel as ChatOpenAI;
  // Como no corpo da requisição: chaves com `undefined` não são enviadas.
  return JSON.parse(JSON.stringify(model.invocationParams({}))) as Record<string, unknown>;
}

describe('spec 011 — FR-002: temperatura e top p opcionais', () => {
  it('FR-002: vazios, não vão ao provedor (o modelo usa o próprio padrão)', async () => {
    const sent = await openAiParams({});
    expect(sent).not.toHaveProperty('temperature');
    expect(sent).not.toHaveProperty('top_p');
  });

  it('FR-002: preenchidos, vão ao provedor', async () => {
    expect(await openAiParams({ temperature: 0.2, topP: 0.9 })).toMatchObject({
      temperature: 0.2,
      top_p: 0.9,
    });
  });

  it('FR-002: o padrão do formulário não preenche temperatura nem top p', () => {
    const props = chatModelNode.paramsSchema.properties as Record<string, { default?: unknown }>;
    expect(props.temperature?.default).toBeUndefined();
    expect(props.topP).toBeDefined();
    expect(props.topP?.default).toBeUndefined();
  });
});
