import { describe, expect, it } from 'vitest';
import { NodeParameterError } from '../../errors.js';
import { fakeContext } from '../../test-support/context.js';
import type { NodeContext } from '../../types.js';
import { FakeScriptedChatModel, type FakeModelStep } from '../runtime/fake-model.js';
import {
  OutputParserError,
  type OutputParseContext,
  type OutputParseStep,
  type OutputParserSupply,
} from '../runtime/output-parser.js';
import type { ChatModelSupply } from '../runtime/types.js';
import {
  DEFAULT_FIX_PROMPT,
  autoFixingOutputParserNode,
  itemListOutputParserNode,
  parseItemList,
  structuredOutputParserNode,
} from './definitions.js';

const supplyOf = async (
  node: typeof structuredOutputParserNode,
  params: Record<string, unknown>,
  subNodes?: NodeContext['subNodes'],
) =>
  (await node.supplyData?.(
    fakeContext({ params, ...(subNodes && { subNodes }) }),
    0,
  )) as OutputParserSupply;

/** Conteúdo de texto de uma mensagem (o modelo simulado recebe texto). */
const textOf = (content: unknown) =>
  typeof content === 'string' ? content : JSON.stringify(content);

function parseContext() {
  const usage: { model: string; inputTokens: number }[] = [];
  const steps: OutputParseStep[] = [];
  let calls = 0;
  const context: OutputParseContext = {
    signal: new AbortController().signal,
    hooks: {
      beforeModelCall: () => {
        calls++;
        return Promise.resolve();
      },
      onUsage: (u, model) => {
        usage.push({ model: model.model, inputTokens: u.inputTokens });
        return Promise.resolve();
      },
      onStep: (s) => {
        steps.push(s);
        return Promise.resolve();
      },
    },
  };
  return { context, usage, steps, calls: () => calls };
}

describe('spec 018 — FR-003: Structured Output Parser', () => {
  it('FR-003: a partir de um exemplo JSON, o schema é inferido (tipos e campos obrigatórios)', async () => {
    const parser = await supplyOf(structuredOutputParserNode, {
      schemaType: 'fromJson',
      jsonSchemaExample: '{"titulo": "x", "nota": 7, "tags": ["a"]}',
    });
    const { context } = parseContext();
    await expect(
      parser.parse('{"titulo": "Bom", "nota": 9, "tags": []}', context),
    ).resolves.toEqual({
      titulo: 'Bom',
      nota: 9,
      tags: [],
    });
    await expect(parser.parse('{"titulo": "Bom"}', context)).rejects.toBeInstanceOf(
      OutputParserError,
    );
    expect(parser.formatInstructions()).toContain('"required":["titulo","nota","tags"]');
    expect(parser.fixWithRootModel).toBe(false);
  });

  it('FR-003: JSON Schema manual, com `autoFix` (correção pelo modelo do nó)', async () => {
    const parser = await supplyOf(structuredOutputParserNode, {
      schemaType: 'manual',
      inputSchema: '{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}',
      autoFix: true,
    });
    expect(parser.fixWithRootModel).toBe(true);
    const error = await parser
      .parse('{"ok": "sim"}', parseContext().context)
      .catch((e: unknown) => e);
    expect((error as OutputParserError).problems.join(' ')).toContain('ok');
  });

  it('FR-003: exemplo ou schema inválido cita o parâmetro', async () => {
    await expect(
      supplyOf(structuredOutputParserNode, { schemaType: 'fromJson', jsonSchemaExample: '{ruim' }),
    ).rejects.toBeInstanceOf(NodeParameterError);
    await expect(
      supplyOf(structuredOutputParserNode, { schemaType: 'manual', inputSchema: '[1]' }),
    ).rejects.toThrow('Parâmetro "inputSchema"');
  });
});

describe('spec 018 — FR-005: Item List Output Parser', () => {
  it('FR-005: um item por linha, sem marcadores nem vazios; limite de itens', async () => {
    expect(parseItemList('1. Primeiro\n\n- Segundo\n* Terceiro\n4) Quarto', '\n', -1)).toEqual([
      'Primeiro',
      'Segundo',
      'Terceiro',
      'Quarto',
    ]);
    const parser = await supplyOf(itemListOutputParserNode, { options: { numberOfItems: 2 } });
    await expect(parser.parse('a\nb\nc', parseContext().context)).resolves.toEqual(['a', 'b']);
    expect(parser.formatInstructions()).toContain('no máximo 2 itens');
    await expect(parser.parse('', parseContext().context)).resolves.toEqual([]);
  });

  it('FR-005: separador personalizado', async () => {
    const parser = await supplyOf(itemListOutputParserNode, { options: { separator: ';' } });
    await expect(parser.parse('azul; verde ;vermelho', parseContext().context)).resolves.toEqual([
      'azul',
      'verde',
      'vermelho',
    ]);
    expect(parser.formatInstructions()).toContain('separados por ";"');
  });
});

describe('spec 018 — FR-004/FR-007: Auto-fixing Output Parser', () => {
  const schemaParams = {
    schemaType: 'manual',
    inputSchema: '{"type":"object","required":["nota"],"properties":{"nota":{"type":"number"}}}',
  };
  async function autoFixing(script: FakeModelStep[], params: Record<string, unknown> = {}) {
    const inner = await supplyOf(structuredOutputParserNode, schemaParams);
    const chatModel = new FakeScriptedChatModel(script);
    const model: ChatModelSupply = { provider: 'fake', model: 'modelo-corretor', chatModel };
    const parser = await supplyOf(autoFixingOutputParserNode, params, (kind) =>
      Promise.resolve([
        {
          node: { id: 's', type: 't', name: 's', params: {}, position: [0, 0] },
          type: 't',
          data: kind === 'ai_languageModel' ? model : inner,
        },
      ]),
    );
    return { parser, chatModel };
  }

  it('FR-004/FR-007: a resposta inválida é corrigida pelo modelo do Auto-fixing; uso e passo com esse modelo', async () => {
    const { parser, chatModel } = await autoFixing([
      { content: '{"nota": 8}', usage: { input: 5, output: 2 } },
    ]);
    const { context, usage, steps, calls } = parseContext();
    await expect(parser.parse('nota oito', context)).resolves.toEqual({ nota: 8 });
    expect(calls()).toBe(1);
    expect(usage).toEqual([{ model: 'modelo-corretor', inputTokens: 5 }]);
    expect(steps[0]).toMatchObject({
      kind: 'model',
      content: { model: 'modelo-corretor', fixer: true },
    });
    const sent = textOf(chatModel.calls[0]?.[0]?.content);
    expect(sent).toContain('nota oito');
    expect(sent).toContain('JSON Schema');
    expect(parser.fixWithRootModel).toBe(false);
  });

  it('FR-004: resposta válida não chama o modelo; correção inválida falha (uma tentativa)', async () => {
    const valid = await autoFixing([]);
    await expect(valid.parser.parse('{"nota": 1}', parseContext().context)).resolves.toEqual({
      nota: 1,
    });
    expect(valid.chatModel.calls).toHaveLength(0);
    const invalid = await autoFixing([{ content: 'ainda errado', repeat: true }]);
    await expect(invalid.parser.parse('x', parseContext().context)).rejects.toBeInstanceOf(
      OutputParserError,
    );
    expect(invalid.chatModel.calls).toHaveLength(1);
  });

  it('FR-004: prompt de correção personalizado', async () => {
    const { parser, chatModel } = await autoFixing([{ content: '{"nota": 3}' }], {
      options: { prompt: 'Corrija {completion} conforme {instructions}. Erro: {error}' },
    });
    await parser.parse('três', parseContext().context);
    expect(textOf(chatModel.calls[0]?.[0]?.content)).toMatch(/^Corrija três conforme .*Erro: /s);
    expect(DEFAULT_FIX_PROMPT).toContain('{instructions}');
  });

  it('FR-004: sem modelo ou sem parser interno, falha com a orientação', async () => {
    await expect(supplyOf(autoFixingOutputParserNode, {})).rejects.toThrow(
      'Conecte exatamente um modelo de chat ao Auto-fixing Output Parser',
    );
  });
});
