import { HumanMessage } from '@langchain/core/messages';
import { NodeParameterError } from '../../errors.js';
import type { JSONSchema7, NodeContext, NodeDefinition } from '../../types.js';
import { subNodeExecute } from '../chat-model/definition.js';
import { contentText, extractJson, outputProblems } from '../runtime/agent.js';
import {
  OutputParserError,
  jsonSchemaOfExample,
  type OutputParserSupply,
} from '../runtime/output-parser.js';
import type { ChatModelSupply } from '../runtime/types.js';

/** Exemplo padrão do Structured Output Parser do N8N. */
export const DEFAULT_JSON_EXAMPLE =
  '{\n  "state": "California",\n  "cities": ["Los Angeles", "San Francisco", "San Diego"]\n}';

/** Prompt padrão de correção do Auto-fixing (o do N8N, em português). */
export const DEFAULT_FIX_PROMPT = `Instruções:
--------------
{instructions}
--------------
Resposta:
--------------
{completion}
--------------

A resposta acima não atendeu às restrições das instruções.
Erro:
--------------
{error}
--------------

Tente de novo. Responda somente com uma resposta que atenda às restrições das instruções:`;

const parserOutput = [
  { name: 'ai_outputParser', displayName: 'Output Parser', kind: 'ai_outputParser' as const },
];

// ---------------------------------------------------------------------------------------------
// Structured Output Parser
// ---------------------------------------------------------------------------------------------

function structuredSchema(ctx: NodeContext, itemIndex: number): Record<string, unknown> {
  const manual = ctx.getParam('schemaType', itemIndex) === 'manual';
  const name = manual ? 'inputSchema' : 'jsonSchemaExample';
  const raw = ctx.getParam(name, itemIndex);
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new NodeParameterError(name, manual ? 'JSON Schema inválido' : 'exemplo JSON inválido');
    }
  }
  if (value === null || typeof value !== 'object') {
    throw new NodeParameterError(
      name,
      manual ? 'deve ser um objeto JSON Schema' : 'deve ser um JSON',
    );
  }
  if (manual && Array.isArray(value)) {
    throw new NodeParameterError(name, 'deve ser um objeto JSON Schema');
  }
  return manual ? (value as Record<string, unknown>) : jsonSchemaOfExample(value);
}

/**
 * Structured Output Parser (spec 018, FR-003): objeto JSON definido por um exemplo (o schema é
 * inferido) ou por um JSON Schema. Com `autoFix`, o nó pai pede a correção ao próprio modelo.
 */
export const structuredOutputParserNode: NodeDefinition = {
  type: 'outputParser.structured',
  version: 1,
  displayName: 'Structured Output Parser',
  description: 'Exige a resposta como um objeto JSON (por exemplo JSON ou JSON Schema).',
  icon: 'braces',
  category: 'ai',
  inputs: [],
  outputs: parserOutput,
  paramsSchema: {
    type: 'object',
    properties: {
      schemaType: {
        type: 'string',
        title: 'Definição do formato',
        description: '`fromJson`: a partir de um exemplo JSON; `manual`: um JSON Schema.',
        enum: ['fromJson', 'manual'],
        default: 'fromJson',
      },
      jsonSchemaExample: {
        type: 'string',
        title: 'Exemplo JSON',
        description: 'Os tipos e os campos (todos obrigatórios) vêm do exemplo.',
        default: DEFAULT_JSON_EXAMPLE,
        'x-multiline': true,
        'x-no-expression': true,
        'x-display-options': { show: { schemaType: ['fromJson'] } },
      } as JSONSchema7,
      inputSchema: {
        type: 'string',
        title: 'JSON Schema',
        default:
          '{\n  "type": "object",\n  "properties": {\n    "resposta": { "type": "string" }\n  },\n  "required": ["resposta"]\n}',
        'x-multiline': true,
        'x-no-expression': true,
        'x-display-options': { show: { schemaType: ['manual'] } },
      } as JSONSchema7,
      autoFix: {
        type: 'boolean',
        title: 'Corrigir automaticamente',
        description:
          'Se a resposta não seguir o formato, o modelo do nó é chamado para corrigi-la (até 2 vezes).',
        default: false,
      },
    },
  },
  execute: subNodeExecute('Structured Output Parser'),
  supplyData: (ctx, itemIndex): Promise<OutputParserSupply> => {
    const schema = structuredSchema(ctx, itemIndex);
    const instructions = `Responda somente com um JSON que siga este JSON Schema:\n\`\`\`json\n${JSON.stringify(schema)}\n\`\`\``;
    return Promise.resolve({
      kind: 'structured',
      formatInstructions: () => instructions,
      fixWithRootModel: ctx.getParam('autoFix', itemIndex) === true,
      parse: (text) => {
        const problems = outputProblems(schema, text);
        if (problems.length > 0) return Promise.reject(new OutputParserError(problems));
        return Promise.resolve(extractJson(text));
      },
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Item List Output Parser
// ---------------------------------------------------------------------------------------------

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** Lista a partir do texto (FR-005): separador, sem marcadores nem vazios, com limite. */
export function parseItemList(text: string, separator: string, limit: number): string[] {
  const items = text
    .split(separator)
    .map((item) => item.replace(BULLET, '').trim())
    .filter(Boolean);
  return limit > 0 ? items.slice(0, limit) : items;
}

/** Item List Output Parser (spec 018, FR-005): a resposta vira uma lista de textos. */
export const itemListOutputParserNode: NodeDefinition = {
  type: 'outputParser.itemList',
  version: 1,
  displayName: 'Item List Output Parser',
  description: 'Transforma a resposta numa lista de itens.',
  icon: 'list',
  category: 'ai',
  inputs: [],
  outputs: parserOutput,
  paramsSchema: {
    type: 'object',
    properties: {
      options: {
        type: 'object',
        title: 'Opções',
        default: {},
        properties: {
          numberOfItems: {
            type: 'integer',
            title: 'Número de itens',
            description: 'Máximo de itens da lista. -1: sem limite.',
            minimum: -1,
            default: -1,
          },
          separator: {
            type: 'string',
            title: 'Separador',
            description: 'Separa os itens na resposta. Padrão: quebra de linha (\\n).',
            default: '\\n',
          },
        },
      },
    },
  },
  execute: subNodeExecute('Item List Output Parser'),
  supplyData: (ctx, itemIndex): Promise<OutputParserSupply> => {
    const raw = (ctx.getParam('options', itemIndex) ?? {}) as Record<string, unknown>;
    const limit = typeof raw.numberOfItems === 'number' ? Math.floor(raw.numberOfItems) : -1;
    // O separador é digitado como texto: `\n` vira a quebra de linha (como no N8N).
    const typed = typeof raw.separator === 'string' && raw.separator !== '' ? raw.separator : '\\n';
    const separator = typed.replaceAll('\\n', '\n');
    const description =
      separator === '\n' ? 'um item por linha' : `itens separados por "${separator}"`;
    const instructions = `Responda somente com uma lista, ${description}${limit > 0 ? `, com no máximo ${String(limit)} itens` : ''}, sem texto antes ou depois.`;
    return Promise.resolve({
      kind: 'itemList',
      formatInstructions: () => instructions,
      fixWithRootModel: false,
      parse: (text) => Promise.resolve(parseItemList(text, separator, limit)),
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Auto-fixing Output Parser
// ---------------------------------------------------------------------------------------------

async function only<T>(
  ctx: NodeContext,
  itemIndex: number,
  kind: 'ai_languageModel' | 'ai_outputParser',
  label: string,
): Promise<T> {
  const [supply, ...extra] = await ctx.subNodes(kind, itemIndex);
  if (!supply || extra.length > 0) {
    throw new Error(`Conecte exatamente um ${label} ao Auto-fixing Output Parser`);
  }
  return supply.data as T;
}

/**
 * Auto-fixing Output Parser (spec 018, FR-004): envolve outro parser; se ele recusar a resposta,
 * o modelo ligado ao Auto-fixing recebe a resposta, o erro e as instruções e devolve a versão
 * corrigida, que passa de novo pelo parser interno (uma tentativa, como no N8N).
 */
export const autoFixingOutputParserNode: NodeDefinition = {
  type: 'outputParser.autoFixing',
  version: 1,
  displayName: 'Auto-fixing Output Parser',
  description: 'Corrige com um modelo a resposta que o parser ligado a ele recusar.',
  icon: 'wrench',
  category: 'ai',
  inputs: [
    {
      name: 'ai_languageModel',
      displayName: 'Modelo',
      kind: 'ai_languageModel',
      required: true,
      maxConnections: 1,
    },
    {
      name: 'ai_outputParser',
      displayName: 'Output Parser',
      kind: 'ai_outputParser',
      required: true,
      maxConnections: 1,
    },
  ],
  outputs: parserOutput,
  paramsSchema: {
    type: 'object',
    properties: {
      options: {
        type: 'object',
        title: 'Opções',
        default: {},
        properties: {
          prompt: {
            type: 'string',
            title: 'Prompt de correção',
            description: 'Use {instructions}, {completion} e {error}.',
            default: DEFAULT_FIX_PROMPT,
            'x-multiline': true,
          } as JSONSchema7,
        },
      },
    },
  },
  execute: subNodeExecute('Auto-fixing Output Parser'),
  supplyData: async (ctx, itemIndex): Promise<OutputParserSupply> => {
    const model = await only<ChatModelSupply>(ctx, itemIndex, 'ai_languageModel', 'modelo de chat');
    const inner = await only<OutputParserSupply>(
      ctx,
      itemIndex,
      'ai_outputParser',
      'output parser',
    );
    const options = (ctx.getParam('options', itemIndex) ?? {}) as Record<string, unknown>;
    const template =
      typeof options.prompt === 'string' && options.prompt.trim()
        ? options.prompt
        : DEFAULT_FIX_PROMPT;
    return {
      kind: 'autoFixing',
      formatInstructions: () => inner.formatInstructions(),
      fixWithRootModel: false,
      parse: async (text, context) => {
        try {
          return await inner.parse(text, context);
        } catch (error) {
          if (!(error instanceof OutputParserError)) throw error;
          const prompt = template
            .replaceAll('{instructions}', inner.formatInstructions())
            .replaceAll('{completion}', text)
            .replaceAll('{error}', error.problems.join('; '));
          await context.hooks.beforeModelCall();
          const response = await model.chatModel.invoke([new HumanMessage(prompt)], {
            signal: context.signal,
          });
          const usage = {
            inputTokens: response.usage_metadata?.input_tokens ?? 0,
            outputTokens: response.usage_metadata?.output_tokens ?? 0,
          };
          await context.hooks.onUsage(usage, model);
          const fixed = contentText(response);
          await context.hooks.onStep({
            kind: 'model',
            content: {
              provider: model.provider,
              model: model.model,
              fixer: true,
              messages: [{ role: 'user', text: prompt }],
              text: fixed,
            },
            ...usage,
          });
          return inner.parse(fixed, context);
        }
      },
    };
  },
};

export const outputParserNodes: readonly NodeDefinition[] = [
  structuredOutputParserNode,
  autoFixingOutputParserNode,
  itemListOutputParserNode,
];
