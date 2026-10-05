import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodeSandbox, IsolateEvaluator } from '@olly/expressions/isolate';
import { createNodeRegistry } from '@olly/nodes';
import type { Item, WorkflowDefinition } from '@olly/shared-types';
import { afterAll, describe, expect, it } from 'vitest';
import { runWorkflow } from './run.js';

const root = fileURLToPath(new URL('../../../fixtures', import.meta.url));
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
// Casos N8N com equivalente no formato Olly (os demais dependem de nós ainda não implementados).
const cases = readdirSync(join(root, 'n8n'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, 'olly', d.name, 'workflow.json')))
  .map((d) => d.name);

// Limite folgado: estes testes verificam semântica, não o timeout (ver sandbox.test.ts).
const evaluator = new IsolateEvaluator({ timeoutMs: 2000 });
const codeRunner = new CodeSandbox({ timeoutMs: 5000 });
afterAll(() => {
  evaluator.disposeAll();
});

describe('spec 003 — FR-019/SC-002: fixtures aplicáveis', () => {
  it('SC-002: há ao menos uma fixture aplicável', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('SC-002: %s produz a saída esperada', async (name) => {
    const definition = read(join(root, 'olly', name, 'workflow.json')) as WorkflowDefinition;
    const input = read(join(root, 'n8n', name, 'input.json')) as { trigger: string; items: Item[] };
    const expected = read(join(root, 'n8n', name, 'expected.json')) as Record<
      string,
      Record<string, Item[]>
    >;
    const trigger = definition.nodes.find((n) => n.name === input.trigger);

    const result = await runWorkflow(definition, createNodeRegistry(), {
      evaluator,
      codeRunner,
      ...(trigger && { startNodeId: trigger.id }),
      triggerItems: input.items,
    });
    expect(result.status).toBe('success');

    for (const [nodeName, ports] of Object.entries(expected)) {
      const node = definition.nodes.find((n) => n.name === nodeName);
      expect(node, `nó ${nodeName}`).toBeDefined();
      const output = result.nodes[node?.id ?? '']?.output ?? {};
      for (const [port, items] of Object.entries(ports)) {
        expect(
          (output[port] ?? []).map((i) => i.json),
          `${nodeName}.${port}`,
        ).toEqual(items.map((i) => i.json));
      }
    }
  });
});
