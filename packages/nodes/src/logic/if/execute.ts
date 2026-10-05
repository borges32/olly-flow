import type { Item, NodeOutput } from '@olly/shared-types';
import { settle } from '../../errors.js';
import type { NodeContext, NodeExecuteInput } from '../../types.js';
import { matchesConditions, type ConditionGroup } from './conditions.js';

export function executeIf(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput> {
  return settle(() => routeItems(input, ctx));
}

function routeItems(input: NodeExecuteInput, ctx: NodeContext): NodeOutput {
  const raw = ctx.node.params.conditions as ConditionGroup | undefined;
  const output: { true: Item[]; false: Item[] } = { true: [], false: [] };
  input.items.forEach((item, i) => {
    const resolved = (ctx.getParam('conditions', i) ?? {}) as ConditionGroup;
    const loose = ctx.getParam('looseTypeValidation', i) === true;
    const pass = matchesConditions(raw, resolved, loose, 'conditions.conditions', i);
    output[pass ? 'true' : 'false'].push({ ...item, pairedItem: { item: i } });
  });
  return output;
}
