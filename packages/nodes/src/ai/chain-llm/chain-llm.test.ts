import type { Item } from '@olly/shared-types';
import { FALLBACK_MODEL_PORT, resolveNodePorts } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { NodeParameterError } from '../../errors.js';
import { fakeContext } from '../../test-support/context.js';
import type { NodeContext } from '../../types.js';
import { FakeScriptedChatModel, type FakeModelStep } from '../runtime/fake-model.js';
import type {
  AgentStepInput,
  AiGateway,
  AiUsageInput,
  ChatModelProvider,
  ChatModelSupply,
} from '../runtime/types.js';
import { structuredOutputParserNode } from '../output-parsers/definitions.js';
import type { OutputParserSupply } from '../runtime/output-parser.js';
import { chainLlmNode } from './definition.js';

const supply = (
  script: FakeModelStep[],
  model = 'modelo-principal',
  provider: ChatModelProvider = 'fake',
) => {
  const chatModel = new FakeScriptedChatModel(script);
  return { supply: { provider, model, chatModel } satisfies ChatModelSupply, chatModel };
};

function gateway(options: { limitReached?: boolean } = {}) {
  const usage: AiUsageInput[] = [];
  const steps: AgentStepInput[] = [];
  const ai: AiGateway = {
    checkModel: () => Promise.resolve(),
    beforeModelCall: () => {
      if (!options.limitReached) return Promise.resolve();
      const error = new Error('Limite mensal de tokens do projeto atingido');
      error.name = 'TokenLimitExceededError';
      return Promise.reject(error);
    },
    recordUsage: (u) => {
      usage.push(u);
      return Promise.resolve();
    },
    recordStep: (s) => {
      steps.push(s);
      return Promise.resolve();
    },
    persistentMemory: () => ({ load: () => Promise.resolve([]), append: () => Promise.resolve() }),
    executionMemory: () => ({ load: () => Promise.resolve([]), append: () => Promise.resolve() }),
    fetch,
    fetchFor: () => fetch,
    limits: { maxIterations: 10, toolResultMaxChars: 1000 },
    allowFakeModel: true,
  };
  return { ai, usage, steps };
}

/** Sub-nós por entrada, como o motor entrega (`subNodes(kind, item, { port })`). */
const subNodesFor =
  (byPort: Record<string, unknown[]>): NodeContext['subNodes'] =>
  (_kind, _item, options) =>
    Promise.resolve(
      (byPort[options?.port ?? 'ai_languageModel'] ?? []).map((data) => ({
        node: { id: 'm', type: 'ai.chatModel', name: 'Modelo', params: {}, position: [0, 0] },
        type: 'ai.chatModel',
        data,
      })),
    );

async function run(
  params: Record<string, unknown>,
  models: Record<string, unknown[]>,
  options: {
    items?: Item[];
    onError?: 'continue' | 'errorOutput';
    limitReached?: boolean;
    signal?: AbortSignal;
  } = {},
) {
  const { ai, usage, steps } = gateway(options);
  const ctx = fakeContext({
    params: { promptSource: 'define', ...params },
    ai,
    subNodes: subNodesFor(models),
    ...(options.signal && { signal: options.signal }),
    node: {
      type: 'ai.chainLlm',
      ...(options.onError && { settings: { onError: options.onError } }),
    },
  });
  const items = options.items ?? [{ json: {} }];
  const output = await chainLlmNode.execute({ inputs: { main: items }, items }, ctx);
  return { output, usage, steps };
}

describe('spec 017 — HU-1: Basic LLM Chain', () => {
  it('FR-001/FR-002/FR-004: uma chamada por item com o prompt definido; saída em `text`, ligada ao item', async () => {
    const { supply: model, chatModel } = supply([
      { content: 'Resumo: {{lastHuman}}', repeat: true },
    ]);
    const { output } = await run(
      { text: 'Resuma o pedido' },
      { ai_languageModel: [model] },
      { items: [{ json: { n: 1 } }, { json: { n: 2 } }] },
    );
    expect(output.main).toEqual([
      { json: { text: 'Resumo: Resuma o pedido' }, pairedItem: { item: 0 } },
      { json: { text: 'Resumo: Resuma o pedido' }, pairedItem: { item: 1 } },
    ]);
    expect(chatModel.calls).toHaveLength(2);
  });

  it('FR-002: prompt do campo `chatInput` do item; sem ele, o item falha dizendo o que falta', async () => {
    const { supply: model } = supply([{ content: 'eco: {{lastHuman}}', repeat: true }]);
    const { output } = await run(
      { promptSource: 'fromInput' },
      { ai_languageModel: [model] },
      { items: [{ json: { chatInput: 'oi' } }] },
    );
    expect(output.main?.[0]?.json).toEqual({ text: 'eco: oi' });
    const error = await run(
      { promptSource: 'fromInput' },
      { ai_languageModel: [model] },
      { items: [{ json: {} }] },
    ).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(NodeParameterError);
    expect((error as Error).message).toContain('"chatInput"');
    const empty = await run({ text: '   ' }, { ai_languageModel: [model] }).catch(
      (e: unknown) => e as Error,
    );
    expect((empty as Error).message).toContain('Parâmetro "text"');
  });

  it('FR-003: mensagens de sistema e de exemplo vão antes do prompt, na ordem; texto vazio é ignorado', async () => {
    // O roteiro conta as respostas do assistente já presentes (o exemplo): `repeat` cobre isso.
    const { supply: model, chatModel } = supply([{ content: 'ok', repeat: true }]);
    await run(
      {
        text: 'Classifique: impressora quebrada',
        messages: [
          { role: 'system', text: 'Você classifica chamados.' },
          { role: 'user', text: 'Classifique: senha expirada' },
          { role: 'assistant', text: 'acesso' },
          { role: 'user', text: '  ' },
        ],
      },
      { ai_languageModel: [model] },
    );
    const sent = chatModel.calls[0]?.map((m) => [m.type, m.content]);
    expect(sent).toEqual([
      ['system', 'Você classifica chamados.'],
      ['human', 'Classifique: senha expirada'],
      ['ai', 'acesso'],
      ['human', 'Classifique: impressora quebrada'],
    ]);
  });

  it('FR-001: sem modelo ligado, o item falha com a orientação', async () => {
    await expect(run({ text: 'x' }, {})).rejects.toThrow(
      'Conecte exatamente um modelo de chat à entrada "Modelo"',
    );
  });

  it('FR-007: "continuar" e "saída de erro" valem por item', async () => {
    const { supply: model } = supply([{ content: 'ok', repeat: true }]);
    const items = [{ json: { chatInput: 'a' } }, { json: {} }, { json: { chatInput: 'c' } }];
    const cont = await run(
      { promptSource: 'fromInput' },
      { ai_languageModel: [model] },
      {
        items,
        onError: 'continue',
      },
    );
    expect(cont.output.main?.map((i) => Object.keys(i.json))).toEqual([
      ['text'],
      ['error'],
      ['text'],
    ]);
    const routed = await run(
      { promptSource: 'fromInput' },
      { ai_languageModel: [model] },
      {
        items,
        onError: 'errorOutput',
      },
    );
    expect(routed.output.main).toHaveLength(2);
    expect(routed.output.error).toEqual([expect.objectContaining({ pairedItem: { item: 1 } })]);
  });
});

/** Structured Output Parser (spec 018) com o schema, como sub-nó ligado ao nó. */
const structured = async (schema: string, autoFix = true) =>
  (await structuredOutputParserNode.supplyData?.(
    fakeContext({ params: { schemaType: 'manual', inputSchema: schema, autoFix } }),
    0,
  )) as OutputParserSupply;

describe('spec 017 — HU-2: resposta estruturada (Output Parser, spec 018)', () => {
  const schema = JSON.stringify({
    type: 'object',
    required: ['categoria'],
    properties: { categoria: { type: 'string' } },
  });

  it('FR-005/FR-002 (spec 018): resposta válida vira objeto em `output`; instruções no prompt', async () => {
    const { supply: model, chatModel } = supply([
      { content: '```json\n{"categoria": "hardware"}\n```' },
    ]);
    const { output } = await run(
      { text: 'Classifique', hasOutputParser: true },
      { ai_languageModel: [model], ai_outputParser: [await structured(schema)] },
    );
    expect(output.main?.[0]?.json).toEqual({ output: { categoria: 'hardware' } });
    expect(chatModel.calls[0]?.at(-1)?.content).toEqual(expect.stringContaining('JSON Schema'));
  });

  it('FR-005: resposta fora do formato é corrigida; depois de 2 correções, falha', async () => {
    const { supply: fixed, chatModel } = supply([
      { content: 'é hardware' },
      { content: '{"categoria": "hardware"}' },
    ]);
    const ok = await run(
      { text: 'Classifique', hasOutputParser: true },
      { ai_languageModel: [fixed], ai_outputParser: [await structured(schema)] },
    );
    expect(ok.output.main?.[0]?.json).toEqual({ output: { categoria: 'hardware' } });
    expect(chatModel.calls).toHaveLength(2);
    expect(chatModel.calls[1]?.at(-1)?.content).toEqual(
      expect.stringContaining('não segue o formato exigido'),
    );

    const { supply: stubborn } = supply([{ content: 'não sei', repeat: true }]);
    await expect(
      run(
        { text: 'Classifique', hasOutputParser: true },
        { ai_languageModel: [stubborn], ai_outputParser: [await structured(schema)] },
      ),
    ).rejects.toThrow('não seguiu o formato do output parser após 2 correções');
  });

  it('FR-001 (spec 018): com a opção ligada e sem parser, o item falha; desligada, o parser é ignorado', async () => {
    const { supply: model } = supply([{ content: 'texto livre', repeat: true }]);
    await expect(
      run({ text: 'Oi', hasOutputParser: true }, { ai_languageModel: [model] }),
    ).rejects.toThrow('Conecte exatamente um output parser à entrada "Output Parser"');
    const { output } = await run(
      { text: 'Oi' },
      { ai_languageModel: [model], ai_outputParser: [await structured(schema)] },
    );
    expect(output.main?.[0]?.json).toEqual({ text: 'texto livre' });
  });
});

describe('spec 017 — HU-3/HU-5: uso e passos', () => {
  it('FR-006/FR-012: uso por chamada e passos `model` (mensagens, resposta, tokens) e `final`', async () => {
    const { supply: model } = supply([{ content: 'ok', usage: { input: 10, output: 3 } }]);
    const { usage, steps } = await run(
      { text: 'Oi', messages: [{ role: 'system', text: 'Seja breve.' }] },
      { ai_languageModel: [model] },
    );
    expect(usage).toEqual([
      {
        nodeId: 'n',
        provider: 'fake',
        model: 'modelo-principal',
        inputTokens: 10,
        outputTokens: 3,
      },
    ]);
    expect(steps).toEqual([
      expect.objectContaining({
        stepIndex: 0,
        itemIndex: 0,
        kind: 'model',
        inputTokens: 10,
        outputTokens: 3,
        content: {
          provider: 'fake',
          model: 'modelo-principal',
          fallback: false,
          messages: [
            { role: 'system', text: 'Seja breve.' },
            { role: 'user', text: 'Oi' },
          ],
          text: 'ok',
        },
      }),
      expect.objectContaining({ stepIndex: 1, kind: 'final', content: { text: 'ok' } }),
    ]);
  });

  it('FR-006: limite mensal atingido bloqueia a chamada', async () => {
    const { supply: model, chatModel } = supply([{ content: 'ok' }]);
    await expect(
      run({ text: 'Oi' }, { ai_languageModel: [model] }, { limitReached: true }),
    ).rejects.toThrow('Limite mensal de tokens');
    expect(chatModel.calls).toHaveLength(0);
  });
});

describe('spec 017 — HU-4: modelo reserva', () => {
  const failing = () => supply([], 'principal-fora');

  it('FR-001/FR-011: a entrada "Modelo reserva" só existe com `needsFallback`', () => {
    const names = (needsFallback: boolean) =>
      resolveNodePorts(chainLlmNode, { params: { needsFallback } }).inputs.map((p) => p.name);
    expect(names(false)).toEqual(['main', 'ai_languageModel']);
    expect(names(true)).toEqual(['main', 'ai_languageModel', FALLBACK_MODEL_PORT]);
  });

  it('FR-011/SC-006: o principal falha e a resposta vem do reserva; uso e passos citam o reserva', async () => {
    const { supply: reserve } = supply([{ content: 'do reserva' }], 'modelo-reserva');
    const { output, usage, steps } = await run(
      { text: 'Oi', needsFallback: true },
      { ai_languageModel: [failing().supply], [FALLBACK_MODEL_PORT]: [reserve] },
    );
    expect(output.main?.[0]?.json).toEqual({ text: 'do reserva' });
    expect(usage.map((u) => u.model)).toEqual(['modelo-reserva']);
    expect(steps.map((s) => s.kind)).toEqual(['error', 'model', 'final']);
    expect(steps[0]?.content).toMatchObject({
      model: 'principal-fora',
      message: 'Roteiro do modelo simulado esgotado',
    });
    expect(steps[1]?.content).toMatchObject({ model: 'modelo-reserva', fallback: true });
  });

  it('FR-011: sem `needsFallback`, o reserva ligado é ignorado e a falha do principal vale', async () => {
    const { supply: reserve, chatModel } = supply([{ content: 'x' }], 'modelo-reserva');
    await expect(
      run(
        { text: 'Oi' },
        { ai_languageModel: [failing().supply], [FALLBACK_MODEL_PORT]: [reserve] },
      ),
    ).rejects.toThrow('Roteiro do modelo simulado esgotado');
    expect(chatModel.calls).toHaveLength(0);
  });

  it('FR-011: principal e reserva falhando: o erro cita os dois', async () => {
    await expect(
      run(
        { text: 'Oi', needsFallback: true },
        {
          ai_languageModel: [failing().supply],
          [FALLBACK_MODEL_PORT]: [supply([], 'reserva-fora').supply],
        },
      ),
    ).rejects.toThrow(
      'Modelo principal (principal-fora): Roteiro do modelo simulado esgotado. Modelo reserva (reserva-fora): Roteiro do modelo simulado esgotado',
    );
  });

  it('FR-011: com `needsFallback` e sem modelo na entrada do reserva, o item falha', async () => {
    const { supply: model } = supply([{ content: 'ok' }]);
    await expect(
      run({ text: 'Oi', needsFallback: true }, { ai_languageModel: [model] }),
    ).rejects.toThrow('à entrada "Modelo reserva"');
  });

  it('FR-011: limite mensal e cancelamento não acionam o reserva', async () => {
    const { supply: reserve, chatModel } = supply([{ content: 'x' }], 'modelo-reserva');
    const models = { ai_languageModel: [failing().supply], [FALLBACK_MODEL_PORT]: [reserve] };
    await expect(
      run({ text: 'Oi', needsFallback: true }, models, { limitReached: true }),
    ).rejects.toThrow('Limite mensal');
    const controller = new AbortController();
    controller.abort(new Error('Execução cancelada'));
    await expect(
      run({ text: 'Oi', needsFallback: true }, models, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(chatModel.calls).toHaveLength(0);
  });

  it('FR-005/FR-011: as correções do formato usam o modelo que respondeu (o reserva)', async () => {
    const { supply: reserve, chatModel } = supply(
      [{ content: 'sem json' }, { content: '{"categoria": "rede"}' }],
      'modelo-reserva',
    );
    const { output } = await run(
      {
        text: 'Classifique',
        needsFallback: true,
        hasOutputParser: true,
      },
      {
        ai_languageModel: [failing().supply],
        [FALLBACK_MODEL_PORT]: [reserve],
        ai_outputParser: [await structured('{"type":"object","required":["categoria"]}')],
      },
    );
    expect(output.main?.[0]?.json).toEqual({ output: { categoria: 'rede' } });
    expect(chatModel.calls).toHaveLength(2);
  });
});
