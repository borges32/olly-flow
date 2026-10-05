import { isExpression } from '@olly/expressions';
import { NodeParameterError } from '../../errors.js';
import {
  CONDITION_TYPES,
  ConditionTypeError,
  evaluateCondition,
  type ConditionType,
} from './operators.js';

export interface RawCondition {
  leftValue?: unknown;
  rightValue?: unknown;
  operator?: { type?: unknown; operation?: unknown };
}

/** Grupo de condições do If (e das regras do Switch): `{ combinator, conditions }`. */
export interface ConditionGroup {
  combinator?: unknown;
  conditions?: unknown;
}

const conditionsOf = (group: ConditionGroup | undefined): RawCondition[] =>
  Array.isArray(group?.conditions) ? (group.conditions as RawCondition[]) : [];

/**
 * Avalia um grupo de condições para um item (spec 003, FR-010; reaproveitado pelo Switch na
 * spec 007). `raw` é o grupo antes das expressões (texto digitado é convertido ao tipo da
 * condição; resultado de expressão precisa ter o tipo certo, salvo com `loose`).
 */
export function matchesConditions(
  raw: ConditionGroup | undefined,
  resolved: ConditionGroup | undefined,
  loose: boolean,
  path: string,
  itemIndex: number,
): boolean {
  const rawConditions = conditionsOf(raw);
  const conditions = conditionsOf(resolved);
  const combinator = resolved?.combinator === 'or' ? 'or' : 'and';
  const results = conditions.map((c, k) => {
    const type = c.operator?.type as ConditionType;
    if (!CONDITION_TYPES.includes(type)) {
      throw new NodeParameterError(
        `${path}[${String(k)}].operator.type`,
        `tipo desconhecido ${JSON.stringify(type)}`,
      );
    }
    try {
      return evaluateCondition({
        left: c.leftValue,
        right: c.rightValue,
        type,
        operation: String(c.operator?.operation),
        looseLeft: loose || !isExpression(rawConditions[k]?.leftValue),
        looseRight: loose || !isExpression(rawConditions[k]?.rightValue),
      });
    } catch (error) {
      if (error instanceof ConditionTypeError) {
        throw new NodeParameterError(
          `${path}[${String(k)}]`,
          `${error.message} (item ${String(itemIndex)})`,
        );
      }
      throw error;
    }
  });
  return combinator === 'and' ? results.every(Boolean) : results.some(Boolean);
}
