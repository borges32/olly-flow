import type { PortDef, PortKind } from './workflow.js';

/**
 * Portas que dependem dos parâmetros do nó (spec 007): Merge com N entradas e Switch com uma
 * saída por regra. Descrição declarativa (vai ao editor junto com o tipo do nó).
 */
export type DynamicPorts =
  /** `params.numberInputs` entradas `input1..N` (2–10). */
  | { kind: 'mergeInputs' }
  /** Saídas `output0..N-1` por regra (ou `numberOutputs`) e `fallback` opcional. */
  | { kind: 'switchOutputs' }
  /**
   * Spec 015, FR-016: nó marcador de um nó não suportado. As portas `in0..`/`out0..` vêm de
   * `params.ports` (`{ inputs, outputs }`, listas de tipos de conexão) copiadas das conexões
   * originais; sem elas, uma entrada e uma saída `main`.
   */
  | { kind: 'placeholder' };

/** Porta de erro (spec 007, FR-013): existe quando `settings.onError = 'errorOutput'`. */
export const ERROR_PORT = 'error';

export interface PortedType {
  inputs: PortDef[];
  outputs: PortDef[];
  dynamicPorts?: DynamicPorts;
}

export interface PortedNode {
  params: Record<string, unknown>;
  settings?: { onError?: string } | undefined;
}

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? Math.floor(v) : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Portas efetivas de um nó: as do tipo, as dinâmicas e a de erro. */
export function resolveNodePorts(
  type: PortedType,
  node: PortedNode,
): { inputs: PortDef[]; outputs: PortDef[] } {
  let { inputs, outputs } = type;
  if (type.dynamicPorts?.kind === 'mergeInputs') {
    const n = clampInt(node.params.numberInputs, 2, 10, 2);
    inputs = Array.from({ length: n }, (_, i) => ({
      name: `input${String(i + 1)}`,
      displayName: `Entrada ${String(i + 1)}`,
      kind: 'main' as const,
    }));
  }
  if (type.dynamicPorts?.kind === 'switchOutputs') {
    const options = (node.params.options ?? {}) as { fallbackOutput?: unknown };
    if (node.params.mode === 'expression') {
      const n = clampInt(node.params.numberOutputs, 1, 20, 4);
      outputs = Array.from({ length: n }, (_, i) => ({
        name: `output${String(i)}`,
        displayName: `Saída ${String(i)}`,
        kind: 'main' as const,
      }));
    } else {
      const rules = Array.isArray(node.params.rules) ? (node.params.rules as unknown[]) : [];
      outputs = rules.map((rule, i) => {
        const key = (rule as { outputKey?: unknown } | null)?.outputKey;
        return {
          name: `output${String(i)}`,
          displayName: typeof key === 'string' && key.trim() ? key.trim() : `Saída ${String(i)}`,
          kind: 'main' as const,
        };
      });
      if (options.fallbackOutput === 'extra') {
        outputs = [...outputs, { name: 'fallback', displayName: 'Padrão', kind: 'main' }];
      }
    }
  }
  if (type.dynamicPorts?.kind === 'placeholder') {
    const ports = (node.params.ports ?? {}) as { inputs?: unknown; outputs?: unknown };
    const kinds = (list: unknown): PortKind[] | undefined =>
      Array.isArray(list) && list.length <= 50 && list.every(isPortKind) ? list : undefined;
    const ins = kinds(ports.inputs) ?? ['main'];
    const outs = kinds(ports.outputs) ?? ['main'];
    inputs = ins.map((kind, i) => ({ name: `in${String(i)}`, kind }));
    outputs = outs.map((kind, i) => ({ name: `out${String(i)}`, kind }));
  }
  if (node.settings?.onError === 'errorOutput' && !outputs.some((p) => p.name === ERROR_PORT)) {
    outputs = [...outputs, { name: ERROR_PORT, displayName: 'Erro', kind: 'main' }];
  }
  return { inputs, outputs };
}

const PORT_KINDS: readonly string[] = ['main', 'ai_languageModel', 'ai_memory', 'ai_tool'];
const isPortKind = (v: unknown): v is PortKind => typeof v === 'string' && PORT_KINDS.includes(v);
