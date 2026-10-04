import type { NodeOutput } from '@olly/shared-types';
import type { NodeExecuteInput } from '../../types.js';

export function executeManualTrigger(input: NodeExecuteInput): Promise<NodeOutput> {
  const items = input.items.length > 0 ? input.items : [{ json: {} }];
  return Promise.resolve({ main: items });
}
