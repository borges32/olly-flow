import type { Item, NodeOutput } from '@olly/shared-types';
import { NodeExecutionError, NodeParameterError } from '../../errors.js';
import type { NodeContext, NodeDefinition, NodeExecuteInput } from '../../types.js';

export const WHILE_DEFAULT_MAX_ITERATIONS = 100;
const ACCUMULATE = ['none', 'appendBodyOutput'] as const;

const positiveInt = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;

function condition(ctx: NodeContext): boolean {
  const value = ctx.getParam('condition', 0);
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false' || value === undefined || value === '') return false;
  throw new NodeParameterError(
    'condition',
    `a condição deve resultar em verdadeiro ou falso (resultou em ${JSON.stringify(value)})`,
  );
}

const paired = (items: Item[]) => items.map((item, i) => ({ ...item, pairedItem: { item: i } }));

/**
 * Laço "enquanto" (spec 007, FR-005–FR-007, plan §3). Recebe os itens em `main` (início) e de
 * volta em `continue` (fim de cada volta do corpo). Enquanto a condição for verdadeira, emite
 * os itens em `loop`; quando ficar falsa, emite em `done` os itens da última volta ou, com
 * acumulação, tudo o que o corpo produziu. Passar do limite de iterações é erro (FR-006).
 */
export function executeWhile(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput> {
  const loop = ctx.loop;
  if (!loop) return Promise.reject(new NodeExecutionError('Estado do laço indisponível'));
  try {
    const max = Math.min(
      positiveInt(ctx.getParam('maxIterations', 0), WHILE_DEFAULT_MAX_ITERATIONS),
      ctx.maxLoopIterations,
    );
    const accumulate = ctx.getParam('accumulate', 0) === 'appendBodyOutput';
    loop.maxIterations = max;
    const back = input.inputs.continue;
    const items = back ?? input.inputs.main ?? [];
    if (back && accumulate) loop.accumulated.push(...structuredClone(back));
    // Sem itens, não há o que repetir: o laço termina (evita voltas vazias até o limite).
    if (items.length > 0 && condition(ctx)) {
      if (loop.index >= max) {
        throw new NodeExecutionError(
          `Limite de ${String(max)} iterações atingido: a condição do laço continuou verdadeira`,
          { description: 'Aumente "Máximo de iterações" ou revise a condição' },
        );
      }
      return Promise.resolve({ loop: paired(items), done: [] });
    }
    return Promise.resolve({ loop: [], done: paired(accumulate ? loop.accumulated : items) });
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

export const whileNode: NodeDefinition = {
  type: 'logic.while',
  version: 1,
  displayName: 'Enquanto (While)',
  description:
    'Repete o corpo (saída Laço → entrada Continuar) enquanto a condição for verdadeira; ao final, emite em Concluído.',
  icon: 'repeat',
  category: 'logic',
  inputs: [
    { name: 'main', kind: 'main' },
    { name: 'continue', displayName: 'Continuar', kind: 'main' },
  ],
  outputs: [
    { name: 'loop', displayName: 'Laço', kind: 'main' },
    { name: 'done', displayName: 'Concluído', kind: 'main' },
  ],
  paramsSchema: {
    type: 'object',
    properties: {
      condition: {
        type: 'string',
        title: 'Repetir enquanto',
        description:
          'Expressão avaliada no início e a cada volta, com $json do primeiro item e $loop.index (voltas concluídas).',
        default: '={{ $loop.index < 3 }}',
      },
      maxIterations: {
        type: 'integer',
        title: 'Máximo de iterações',
        minimum: 1,
        maximum: 10_000,
        default: WHILE_DEFAULT_MAX_ITERATIONS,
      },
      accumulate: {
        type: 'string',
        title: 'Saída em Concluído',
        enum: [...ACCUMULATE],
        default: 'none',
        description:
          'none: itens da última volta; appendBodyOutput: tudo o que o corpo devolveu, em ordem.',
      },
    },
    required: ['condition'],
    additionalProperties: false,
  },
  execute: executeWhile,
};
