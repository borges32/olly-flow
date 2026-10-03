import { NodeRegistry } from './registry.js';
import type { NodeDefinition } from './types.js';

/**
 * Nós da plataforma. Cada spec que cria um nó (src/<categoria>/<nome>/definition.ts)
 * o acrescenta aqui; o teste do registro valida todos.
 */
export const builtinNodes: readonly NodeDefinition[] = [];

export function createNodeRegistry(nodes: readonly NodeDefinition[] = builtinNodes): NodeRegistry {
  const registry = new NodeRegistry();
  for (const node of nodes) registry.register(node);
  return registry;
}
