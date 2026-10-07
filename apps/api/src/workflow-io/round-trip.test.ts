import { randomUUID } from 'node:crypto';
import { createNodeRegistry } from '@olly/nodes';
import {
  fromWorkflowFile,
  toWorkflowFile,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@olly/shared-types';
import { describe, expect, it } from 'vitest';

const registry = createNodeRegistry();
const catalog = { get: (t: string) => registry.get(t) };

/** Parâmetros padrão do tipo (o que o editor grava ao adicionar o nó). */
const defaults = (type: string): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(registry.get(type)?.paramsSchema.properties ?? {})
      .filter(([, s]) => typeof s === 'object' && 'default' in s)
      .map(([k, s]) => [k, structuredClone((s as { default: unknown }).default)]),
  );

describe('spec 015 — NFR-001/SC-001/FR-003: ida e volta com todos os tipos de nó', () => {
  it('exporta e importa um workflow com todos os tipos e obtém a mesma definição', () => {
    const types = registry.list().map((t) => t.type);
    const nodes: WorkflowNode[] = types.map((type, i) => ({
      id: randomUUID(),
      name: `Nó ${String(i)} ${type}`,
      type,
      params:
        type === 'placeholder.unsupported'
          ? {
              originalType: 'x.y',
              reason: 'teste',
              originalJson: '{}',
              ports: { inputs: ['main'], outputs: ['main', 'main'] },
            }
          : defaults(type),
      position: [i * 260, (i % 3) * 160],
      ...(i % 4 === 0 && { disabled: true }),
      ...(type === 'http.request' && {
        settings: {
          onError: 'errorOutput' as const,
          retry: { maxTries: 2, waitMs: 10 },
          timeoutMs: 1000,
        },
      }),
    }));
    const byType = (t: string) => nodes.find((n) => n.type === t) as WorkflowNode;
    const edge = (from: string, fromPort: string, to: string, toPort: string) => ({
      id: randomUUID(),
      from: byType(from).id,
      fromPort,
      to: byType(to).id,
      toPort,
    });
    const definition: WorkflowDefinition = {
      nodes,
      edges: [
        edge('trigger.manual', 'main', 'http.request', 'main'),
        edge('http.request', 'error', 'logic.if', 'main'),
        edge('logic.if', 'false', 'logic.merge', 'input2'),
        edge('logic.merge', 'main', 'logic.loopOverItems', 'main'),
        edge('logic.loopOverItems', 'loop', 'data.set', 'main'),
        edge('data.set', 'main', 'logic.loopOverItems', 'continue'),
        edge('logic.while', 'done', 'placeholder.unsupported', 'in0'),
        edge('placeholder.unsupported', 'out1', 'ai.agent', 'main'),
        edge('ai.chatModel', 'ai_languageModel', 'ai.agent', 'ai_languageModel'),
        edge('memory.buffer', 'ai_memory', 'ai.agent', 'ai_memory'),
        edge('tool.code', 'ai_tool', 'ai.agent', 'ai_tool'),
        edge('tool.mcp', 'ai_tool', 'ai.agent', 'ai_tool'),
      ],
      settings: { timeoutSec: 30, maxParallel: 2, saveExecutionData: 'none' },
      pinData: { [byType('trigger.manual').id]: [{ json: { a: 1 } }] },
    };
    const file = toWorkflowFile(definition, { catalog, name: 'Todos os tipos' });
    const back = fromWorkflowFile(JSON.parse(JSON.stringify(file)), { catalog, newId: randomUUID });
    expect(back.issues).toEqual({
      errors: [],
      pending: [expect.objectContaining({ code: 'UNSUPPORTED_NODE' })],
      warnings: [],
    });
    const strip = (d: WorkflowDefinition) => ({
      ...d,
      edges: d.edges.map(({ id: _id, ...e }) => e),
    });
    expect(strip(back.definition)).toEqual(strip(definition));
  });
});
