import type { Item, NodeOutput } from '@olly/shared-types';
import { NodeParameterError } from '../../errors.js';
import type { NodeContext, NodeExecuteInput } from '../../types.js';

export const MERGE_MODES = [
  'append',
  'combineByPosition',
  'combineByFields',
  'chooseBranch',
  'waitAll',
] as const;
export const JOIN_MODES = ['inner', 'left', 'outer', 'keepNonMatches'] as const;
export const CLASH_HANDLING = ['preferInput1', 'preferLast', 'addSuffix'] as const;
export const WAIT_FOR = ['allConnected', 'anyWithData'] as const;

type Clash = (typeof CLASH_HANDLING)[number];

const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
type Tagged = { item: Item; input: number; index: number };

/** Lê um campo com notação de ponto (`cliente.cpf`). */
function getPath(json: Record<string, unknown>, path: string): unknown {
  let current: unknown = json;
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * `merge` raso dos `json` (spec 007, FR-003): na colisão de campos, vale a entrada 1, a última
 * ou todos com sufixo `_<entrada>`.
 */
export function combineJson(
  parts: { json: Record<string, unknown>; input: number }[],
  clash: Clash,
): Record<string, unknown> {
  if (clash === 'addSuffix') {
    const counts = new Map<string, number>();
    for (const p of parts)
      for (const k of Object.keys(p.json)) counts.set(k, (counts.get(k) ?? 0) + 1);
    const out: Record<string, unknown> = {};
    for (const p of parts) {
      for (const [k, v] of Object.entries(p.json)) {
        out[(counts.get(k) ?? 0) > 1 ? `${k}_${String(p.input + 1)}` : k] = v;
      }
    }
    return out;
  }
  const ordered = clash === 'preferInput1' ? [...parts].reverse() : parts;
  return Object.assign({}, ...ordered.map((p) => structuredClone(p.json))) as Record<
    string,
    unknown
  >;
}

const pairOf = (t: Tagged): Item['pairedItem'] => ({ item: t.index, input: t.input });

/**
 * Junta itens de 2 a 10 entradas (spec 007, plan §1). Com `waitFor = anyWithData`, entradas sem
 * dados são ignoradas; com `allConnected` (padrão), entram como listas vazias.
 */
export function executeMerge(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput> {
  try {
    return Promise.resolve({ main: merge(input, ctx) });
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function merge(input: NodeExecuteInput, ctx: NodeContext): Item[] {
  const p = (name: string) => ctx.getParam(name, 0);
  const count = Math.min(10, Math.max(2, Number(p('numberInputs') ?? 2) || 2));
  const waitFor = p('waitFor') === 'anyWithData' ? 'anyWithData' : 'allConnected';
  const clash = (CLASH_HANDLING as readonly string[]).includes(String(p('clashHandling')))
    ? (p('clashHandling') as Clash)
    : 'preferLast';
  let inputs = Array.from({ length: count }, (_, k) =>
    (input.inputs[`input${String(k + 1)}`] ?? []).map((item, index) => ({
      item,
      input: k,
      index,
    })),
  );
  if (waitFor === 'anyWithData') inputs = inputs.filter((list) => list.length > 0);
  const mode = text(p('mode'), 'append');

  switch (mode) {
    case 'append':
      return inputs.flat().map((t) => ({ ...t.item, pairedItem: pairOf(t) }));

    case 'combineByPosition': {
      const includeUnpaired = p('includeUnpaired') === true;
      const lengths = inputs.map((list) => list.length);
      const total = includeUnpaired ? Math.max(0, ...lengths) : Math.min(...lengths, Infinity);
      const out: Item[] = [];
      for (let i = 0; i < (Number.isFinite(total) ? total : 0); i++) {
        const row = inputs.map((list) => list[i]).filter((t): t is Tagged => t !== undefined);
        const first = row[0];
        if (!first) continue;
        out.push({
          json: combineJson(
            row.map((t) => ({ json: t.item.json, input: t.input })),
            clash,
          ),
          pairedItem: pairOf(first),
        });
      }
      return out;
    }

    case 'combineByFields':
      return combineByFields(inputs, p, clash, count);

    case 'chooseBranch': {
      if (p('output') === 'empty') return [{ json: {} }];
      const chosen = Math.max(1, Number(p('chosenInput') ?? 1) || 1);
      const list =
        inputs.find((l) => l[0]?.input === chosen - 1) ??
        (waitFor === 'allConnected' ? inputs[chosen - 1] : undefined) ??
        [];
      return list.map((t) => ({ ...t.item, pairedItem: pairOf(t) }));
    }

    case 'waitAll':
      return (inputs[0] ?? []).map((t) => ({ ...t.item, pairedItem: pairOf(t) }));

    default:
      throw new NodeParameterError('mode', `modo desconhecido "${mode}"`);
  }
}

/** Join por campos entre as 2 entradas, com índice hash (O(n + m)). */
function combineByFields(
  inputs: Tagged[][],
  p: (name: string) => unknown,
  clash: Clash,
  count: number,
): Item[] {
  if (count !== 2) {
    throw new NodeParameterError('numberInputs', 'combinar por campos exige exatamente 2 entradas');
  }
  const pairs = (Array.isArray(p('fields')) ? (p('fields') as unknown[]) : []).map((f) => {
    const field = f as { input1Field?: unknown; input2Field?: unknown };
    return {
      left: text(field.input1Field, '').trim(),
      right: text(field.input2Field, '').trim(),
    };
  });
  if (pairs.length === 0 || pairs.some((f) => !f.left || !f.right)) {
    throw new NodeParameterError('fields', 'informe os campos de cada entrada para combinar');
  }
  const joinMode = text(p('joinMode'), 'inner');
  if (!(JOIN_MODES as readonly string[]).includes(joinMode)) {
    throw new NodeParameterError('joinMode', `tipo de junção desconhecido "${joinMode}"`);
  }
  const [left = [], right = []] = inputs;
  const key = (json: Record<string, unknown>, side: 'left' | 'right') => {
    const values = pairs.map((f) => getPath(json, side === 'left' ? f.left : f.right));
    // Campo ausente nunca casa.
    return values.some((v) => v === undefined || v === null) ? null : JSON.stringify(values);
  };
  const index = new Map<string, Tagged[]>();
  for (const t of right) {
    const k = key(t.item.json, 'right');
    if (k !== null) index.set(k, [...(index.get(k) ?? []), t]);
  }
  const matchedRight = new Set<Tagged>();
  const out: Item[] = [];
  const unmatchedLeft: Tagged[] = [];
  for (const t of left) {
    const k = key(t.item.json, 'left');
    const matches = k === null ? [] : (index.get(k) ?? []);
    if (matches.length === 0) {
      unmatchedLeft.push(t);
      if (joinMode === 'left' || joinMode === 'outer') {
        out.push({ ...t.item, pairedItem: pairOf(t) });
      }
      continue;
    }
    for (const m of matches) {
      matchedRight.add(m);
      if (joinMode === 'keepNonMatches') continue;
      out.push({
        json: combineJson(
          [
            { json: t.item.json, input: 0 },
            { json: m.item.json, input: 1 },
          ],
          clash,
        ),
        pairedItem: pairOf(t),
      });
    }
  }
  const unmatchedRight = right.filter((t) => !matchedRight.has(t));
  if (joinMode === 'outer') {
    out.push(...unmatchedRight.map((t) => ({ ...t.item, pairedItem: pairOf(t) })));
  }
  if (joinMode === 'keepNonMatches') {
    return [...unmatchedLeft, ...unmatchedRight].map((t) => ({ ...t.item, pairedItem: pairOf(t) }));
  }
  return out;
}
