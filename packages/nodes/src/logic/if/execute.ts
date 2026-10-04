import { isExpression } from '@olly/expressions';
import type { Item, NodeOutput } from '@olly/shared-types';
import { NodeParameterError, settle } from '../../errors.js';
import type { NodeContext, NodeExecuteInput } from '../../types.js';
import {
  CONDITION_TYPES,
  ConditionTypeError,
  evaluateCondition,
  type ConditionType,
} from './operators.js';

interface RawCondition {
  leftValue?: unknown;
  rightValue?: unknown;
  operator?: { type?: unknown; operation?: unknown };
}

const rawConditions = (ctx: NodeContext): RawCondition[] => {
  const conditions = (ctx.node.params.conditions as { conditions?: unknown } | undefined)
    ?.conditions;
  return Array.isArray(conditions) ? (conditions as RawCondition[]) : [];
};

export function executeIf(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput> {
  return settle(() => routeItems(input, ctx));
}

function routeItems(input: NodeExecuteInput, ctx: NodeContext): NodeOutput {
  // Texto digitado no editor é sempre convertido para o tipo da condição; resultados de
  // expressões precisam ter o tipo certo, salvo com a conversão flexível (como no N8N).
  const raw = rawConditions(ctx);
  const output: { true: Item[]; false: Item[] } = { true: [], false: [] };

  input.items.forEach((item, i) => {
    const params = (ctx.getParam('conditions', i) ?? {}) as {
      combinator?: unknown;
      conditions?: unknown;
    };
    const loose = ctx.getParam('looseTypeValidation', i) === true;
    const combinator = params.combinator === 'or' ? 'or' : 'and';
    const conditions = Array.isArray(params.conditions)
      ? (params.conditions as RawCondition[])
      : [];

    const results = conditions.map((c, k) => {
      const type = c.operator?.type as ConditionType;
      if (!CONDITION_TYPES.includes(type)) {
        throw new NodeParameterError(
          `conditions.conditions[${k}].operator.type`,
          `tipo desconhecido ${JSON.stringify(type)}`,
        );
      }
      try {
        return evaluateCondition({
          left: c.leftValue,
          right: c.rightValue,
          type,
          operation: String(c.operator?.operation),
          looseLeft: loose || !isExpression(raw[k]?.leftValue),
          looseRight: loose || !isExpression(raw[k]?.rightValue),
        });
      } catch (error) {
        if (error instanceof ConditionTypeError) {
          throw new NodeParameterError(
            `conditions.conditions[${k}]`,
            `${error.message} (item ${i})`,
          );
        }
        throw error;
      }
    });
    const pass = combinator === 'and' ? results.every(Boolean) : results.some(Boolean);
    output[pass ? 'true' : 'false'].push({ ...item, pairedItem: { item: i } });
  });

  return output;
}
