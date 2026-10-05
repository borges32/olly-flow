import type { JSONSchema7 } from 'json-schema';
import type { Item, NodeOutput } from '@olly/shared-types';
import { NodeParameterError } from '../../errors.js';
import type { NodeContext, NodeDefinition, NodeExecuteInput } from '../../types.js';
import { matchesConditions, type ConditionGroup } from '../if/conditions.js';
import { ifNode } from '../if/definition.js';

interface Rule {
  conditions?: ConditionGroup;
  outputKey?: unknown;
}

const rulesOf = (value: unknown): Rule[] => (Array.isArray(value) ? (value as Rule[]) : []);

/**
 * Roteamento por regras ou por índice (spec 007, FR-012, plan §5). Equivale ao
 * `n8n-nodes-base.switch` v3: uma saída por regra (`output0..N`), saída de fallback opcional e
 * envio a todas as regras verdadeiras.
 */
export function executeSwitch(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput> {
  try {
    return Promise.resolve(route(input, ctx));
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function route(input: NodeExecuteInput, ctx: NodeContext): NodeOutput {
  const output: NodeOutput = {};
  const push = (port: string, item: Item, i: number) => {
    (output[port] ??= []).push({ ...item, pairedItem: { item: i } });
  };

  if (ctx.node.params.mode === 'expression') {
    const n = Math.min(20, Math.max(1, Number(ctx.getParam('numberOutputs', 0) ?? 4) || 4));
    for (let k = 0; k < n; k++) output[`output${String(k)}`] = [];
    input.items.forEach((item, i) => {
      const value = Number(ctx.getParam('output', i));
      if (!Number.isInteger(value) || value < 0 || value >= n) {
        throw new NodeParameterError(
          'output',
          `o índice da saída deve ser um inteiro de 0 a ${String(n - 1)} (item ${String(i)}: ${JSON.stringify(ctx.getParam('output', i))})`,
        );
      }
      push(`output${String(value)}`, item, i);
    });
    return output;
  }

  const rawRules = rulesOf(ctx.node.params.rules);
  const options = (ctx.node.params.options ?? {}) as {
    fallbackOutput?: unknown;
    allMatchingOutputs?: unknown;
  };
  rawRules.forEach((_, k) => (output[`output${String(k)}`] = []));
  const fallback = options.fallbackOutput;
  if (fallback === 'extra') output.fallback = [];
  const loose = ctx.getParam('looseTypeValidation', 0) === true;

  input.items.forEach((item, i) => {
    const rules = rulesOf(ctx.getParam('rules', i));
    let matched = false;
    for (let k = 0; k < rawRules.length; k++) {
      const ok = matchesConditions(
        rawRules[k]?.conditions,
        rules[k]?.conditions,
        loose,
        `rules[${String(k)}].conditions.conditions`,
        i,
      );
      if (!ok) continue;
      matched = true;
      push(`output${String(k)}`, item, i);
      if (options.allMatchingOutputs !== true) break;
    }
    if (matched) return;
    if (fallback === 'extra') push('fallback', item, i);
    else if (typeof fallback === 'number' && output[`output${String(fallback)}`]) {
      push(`output${String(fallback)}`, item, i);
    }
  });
  return output;
}

const conditionsSchema = (ifNode.paramsSchema.properties as Record<string, JSONSchema7>)
  .conditions as JSONSchema7;

export const switchNode: NodeDefinition = {
  type: 'logic.switch',
  version: 1,
  displayName: 'Roteador (Switch)',
  description:
    'Encaminha cada item para a saída da primeira regra verdadeira (ou de todas), com saída padrão opcional.',
  icon: 'split',
  category: 'logic',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [],
  dynamicPorts: { kind: 'switchOutputs' },
  paramsSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        title: 'Modo',
        enum: ['rules', 'expression'],
        default: 'rules',
        'x-no-expression': true,
      } as JSONSchema7,
      rules: {
        type: 'array',
        title: 'Regras (uma saída por regra)',
        default: [{ conditions: { combinator: 'and', conditions: [] }, outputKey: '' }],
        'x-display-options': { show: { mode: ['rules'] } },
        items: {
          type: 'object',
          properties: {
            conditions: conditionsSchema,
            outputKey: {
              type: 'string',
              title: 'Nome da saída',
              default: '',
              'x-no-expression': true,
            } as JSONSchema7,
          },
          additionalProperties: false,
        },
      } as JSONSchema7,
      numberOutputs: {
        type: 'integer',
        title: 'Número de saídas',
        minimum: 1,
        maximum: 20,
        default: 4,
        'x-no-expression': true,
        'x-display-options': { show: { mode: ['expression'] } },
      } as JSONSchema7,
      output: {
        type: 'string',
        title: 'Índice da saída',
        description: 'Expressão que devolve o número da saída (0, 1, 2...) para cada item.',
        default: '={{ 0 }}',
        'x-display-options': { show: { mode: ['expression'] } },
      } as JSONSchema7,
      looseTypeValidation: {
        type: 'boolean',
        title: 'Conversão flexível de tipos',
        default: false,
        'x-display-options': { show: { mode: ['rules'] } },
      } as JSONSchema7,
      options: {
        type: 'object',
        title: 'Opções',
        default: {},
        'x-display-options': { show: { mode: ['rules'] } },
        properties: {
          fallbackOutput: {
            title: 'Itens sem regra verdadeira',
            description: 'none: descarta; extra: saída "Padrão"; ou o número de uma saída.',
            oneOf: [
              { type: 'string', enum: ['none', 'extra'] },
              { type: 'integer', minimum: 0 },
            ],
            default: 'none',
            'x-no-expression': true,
          } as JSONSchema7,
          allMatchingOutputs: {
            type: 'boolean',
            title: 'Enviar a todas as regras verdadeiras',
            default: false,
          },
        },
        additionalProperties: false,
      } as JSONSchema7,
    },
    additionalProperties: false,
  },
  execute: executeSwitch,
};
