import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IsolateEvaluator } from '@olly/expressions/isolate';
import { createNodeRegistry } from '@olly/nodes';
import type { Item, WorkflowDefinition } from '@olly/shared-types';
import { afterAll, describe, expect, it } from 'vitest';
import { runWorkflow, type RunResult } from './run.js';

/**
 * Suíte de referência da semântica do motor (spec 007, FR-017, plan §8): cada caso em
 * `reference/*.json` roda com `maxParallel` 1 e 8, e os resultados precisam ser idênticos.
 */
interface ReferenceCase {
  description: string;
  requirements: string[];
  definition: WorkflowDefinition;
  input: Item[];
  /** Por nome do nó: itens (só `json`) por porta de saída. */
  expected: Record<string, Record<string, unknown[]>>;
  /** Por nome do nó: quantas vezes executou (iterações). */
  runs?: Record<string, number>;
  /** Trecho da mensagem de erro esperada. */
  expectError?: string;
}

const dir = fileURLToPath(new URL('../reference/', import.meta.url));
const cases = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((file) => ({
    file,
    data: JSON.parse(readFileSync(`${dir}${file}`, 'utf8')) as ReferenceCase,
  }));

const evaluator = new IsolateEvaluator({ timeoutMs: 2000 });
const registry = createNodeRegistry();
afterAll(() => {
  evaluator.disposeAll();
});

interface Outcome {
  result: RunResult;
  runs: Record<string, number>;
  /** Saída de cada nó por nome, só `json`. */
  outputs: Record<string, Record<string, unknown[]>>;
}

async function execute(c: ReferenceCase, maxParallel: number): Promise<Outcome> {
  const definition = { ...c.definition, settings: { ...c.definition.settings, maxParallel } };
  const names = new Map(definition.nodes.map((n) => [n.id, n.name]));
  const runs: Record<string, number> = {};
  const result = await runWorkflow(definition, registry, {
    evaluator,
    triggerItems: c.input,
    ...(definition.pinData && { pinData: definition.pinData }),
    executionId: `ref-${String(maxParallel)}-${Math.random().toString(36).slice(2)}`,
    callbacks: {
      onNodeStart: (nodeId) => {
        const name = names.get(nodeId) ?? nodeId;
        runs[name] = (runs[name] ?? 0) + 1;
      },
    },
  });
  const outputs = Object.fromEntries(
    Object.entries(result.nodes).map(([id, n]) => [
      names.get(id) ?? id,
      Object.fromEntries(
        Object.entries(n.output ?? {}).map(([port, items]) => [port, items.map((i) => i.json)]),
      ),
    ]),
  );
  return { result, runs, outputs };
}

describe('spec 007 — FR-017/SC-001: suíte de referência do motor', () => {
  it('SC-001: ao menos 15 casos', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  it.each(cases)('$file', async ({ data }) => {
    const [sequential, parallel] = [await execute(data, 1), await execute(data, 8)];
    for (const { result, runs, outputs } of [sequential, parallel]) {
      if (data.expectError) {
        expect(result.status).toBe('error');
        expect(result.error?.message).toContain(data.expectError);
      } else {
        expect(result.error).toBeUndefined();
        expect(result.status).toBe('success');
      }
      for (const [name, ports] of Object.entries(data.expected)) {
        for (const [port, items] of Object.entries(ports)) {
          expect(outputs[name]?.[port], `${name}.${port}`).toEqual(items);
        }
      }
      for (const [name, count] of Object.entries(data.runs ?? {})) {
        expect(runs[name] ?? 0, `execuções de ${name}`).toBe(count);
      }
    }
    // FR-017: paralelismo 1 e 8 dão exatamente o mesmo resultado.
    expect(parallel.outputs).toEqual(sequential.outputs);
    expect(parallel.runs).toEqual(sequential.runs);
  });
});
