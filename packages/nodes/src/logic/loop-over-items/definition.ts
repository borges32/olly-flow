import type { Item, NodeOutput } from '@olly/shared-types';
import { NodeExecutionError } from '../../errors.js';
import type { NodeContext, NodeDefinition, NodeExecuteInput } from '../../types.js';

export const DEFAULT_BATCH_SIZE = 10;

const positiveInt = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;
const paired = (items: Item[], offset = 0) =>
  items.map((item, i) => ({ ...item, pairedItem: { item: offset + i } }));

/**
 * Processa itens em lotes (spec 007, FR-011, plan §4), compatível com o Split in Batches v3
 * do N8N: o primeiro lote sai em `loop`; a cada volta (`continue`), os itens recebidos são
 * acumulados e sai o próximo lote; sem lotes restantes, `done` recebe tudo o que voltou.
 */
export function executeLoopOverItems(
  input: NodeExecuteInput,
  ctx: NodeContext,
): Promise<NodeOutput> {
  const loop = ctx.loop;
  if (!loop) return Promise.reject(new NodeExecutionError('Estado do laço indisponível'));
  const size = positiveInt(ctx.getParam('batchSize', 0), DEFAULT_BATCH_SIZE);
  const back = input.inputs.continue;
  if (!back) {
    const items = input.inputs.main ?? [];
    loop.data.queue = items.slice(size);
    loop.data.offset = Math.min(size, items.length);
    loop.maxIterations = Math.ceil(items.length / size);
    const batch = items.slice(0, size);
    return Promise.resolve(
      batch.length > 0 ? { done: [], loop: paired(batch) } : { done: [], loop: [] },
    );
  }
  loop.accumulated.push(...structuredClone(back));
  const queue = (loop.data.queue ?? []) as Item[];
  const offset = (loop.data.offset ?? 0) as number;
  if (queue.length === 0) return Promise.resolve({ done: loop.accumulated, loop: [] });
  loop.data.queue = queue.slice(size);
  loop.data.offset = offset + Math.min(size, queue.length);
  return Promise.resolve({ done: [], loop: paired(queue.slice(0, size), offset) });
}

export const loopOverItemsNode: NodeDefinition = {
  type: 'logic.loopOverItems',
  version: 1,
  displayName: 'Loop em lotes (Loop Over Items)',
  description:
    'Envia os itens em lotes pela saída Lote; cada lote volta pela entrada Continuar; ao final, Concluído recebe todos.',
  icon: 'layers',
  category: 'logic',
  inputs: [
    { name: 'main', kind: 'main' },
    { name: 'continue', displayName: 'Continuar', kind: 'main' },
  ],
  // Mesma ordem do Split in Batches v3 do N8N: done (0) e loop (1).
  outputs: [
    { name: 'done', displayName: 'Concluído', kind: 'main' },
    { name: 'loop', displayName: 'Lote', kind: 'main' },
  ],
  paramsSchema: {
    type: 'object',
    properties: {
      batchSize: {
        type: 'integer',
        title: 'Tamanho do lote',
        minimum: 1,
        default: DEFAULT_BATCH_SIZE,
      },
    },
    additionalProperties: false,
  },
  execute: executeLoopOverItems,
};
