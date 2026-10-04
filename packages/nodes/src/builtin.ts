import { setNode } from './data/set/definition.js';
import { setVariableNode } from './data/set-variable/definition.js';
import { ifNode } from './logic/if/definition.js';
import { NodeRegistry } from './registry.js';
import { manualTrigger } from './trigger/manual/definition.js';
import type { NodeDefinition } from './types.js';

/**
 * Nós da plataforma. Cada spec que cria um nó (src/<categoria>/<nome>/definition.ts)
 * o acrescenta aqui; o teste do registro valida todos.
 */
export const builtinNodes: readonly NodeDefinition[] = [
  manualTrigger,
  setNode,
  setVariableNode,
  ifNode,
];

export function createNodeRegistry(nodes: readonly NodeDefinition[] = builtinNodes): NodeRegistry {
  const registry = new NodeRegistry();
  for (const node of nodes) registry.register(node);
  return registry;
}
