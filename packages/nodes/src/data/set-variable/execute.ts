import type { NodeOutput } from '@olly/shared-types';
import { NodeParameterError, settle } from '../../errors.js';
import type { NodeContext, NodeExecuteInput } from '../../types.js';

export function executeSetVariable(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput> {
  return settle(() => storeVariables(input, ctx));
}

function storeVariables(input: NodeExecuteInput, ctx: NodeContext): NodeOutput {
  input.items.forEach((_, i) => {
    const variables = ctx.getParam('variables', i) ?? [];
    if (!Array.isArray(variables)) throw new NodeParameterError('variables', 'deve ser uma lista');
    variables.forEach((v: unknown, k) => {
      const { name, value } = (v ?? {}) as { name?: unknown; value?: unknown };
      if (typeof name !== 'string' || !name.trim()) {
        throw new NodeParameterError(`variables[${k}].name`, 'nome da variável vazio');
      }
      ctx.setVariable(name.trim(), value);
    });
  });
  return { main: input.items.map((item, i) => ({ ...item, pairedItem: { item: i } })) };
}
