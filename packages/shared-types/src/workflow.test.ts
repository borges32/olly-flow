import { describe, expect, it } from 'vitest';
import { itemSchema, workflowDefinitionSchema, type WorkflowDefinition } from './index.js';

function definition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    nodes: [
      { id: 'n1', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
      {
        id: 'n2',
        type: 'data.set',
        name: 'Definir',
        params: { campo: '=valor {{ $json.x }}' },
        position: [200, 0],
        settings: {
          retry: { maxTries: 3, waitMs: 1000, backoff: 'exponential' },
          onError: 'errorOutput',
        },
      },
    ],
    edges: [{ id: 'e1', from: 'n1', fromPort: 'main', to: 'n2', toPort: 'main' }],
    settings: { maxParallel: 8, saveExecutionData: 'all' },
    ...overrides,
  };
}

describe('FR-013: schemas zod dos contratos centrais', () => {
  it('FR-013: aceita uma WorkflowDefinition válida', () => {
    const def = definition({ pinData: { n1: [{ json: { a: 1 } }] } });
    expect(workflowDefinitionSchema.parse(def)).toEqual(def);
  });

  it('FR-013: rejeita nó sem campos obrigatórios', () => {
    const result = workflowDefinitionSchema.safeParse({
      nodes: [{ id: 'n1', type: 'trigger.manual' }],
      edges: [],
      settings: {},
    });
    expect(result.success).toBe(false);
  });

  it('FR-013: rejeita ids e nomes de nó duplicados', () => {
    const base = definition();
    const [first] = base.nodes;
    if (!first) throw new Error('fixture inválida');
    const result = workflowDefinitionSchema.safeParse({
      ...base,
      nodes: [...base.nodes, { ...first }],
    });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain('id de nó duplicado: n1');
    expect(messages).toContain('nome de nó duplicado: Início');
  });

  it('FR-013: rejeita aresta para nó inexistente', () => {
    const result = workflowDefinitionSchema.safeParse(
      definition({ edges: [{ id: 'e1', from: 'n1', fromPort: 'main', to: 'nX', toPort: 'main' }] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('nó inexistente: nX');
  });

  it('FR-013: rejeita pinData de nó inexistente', () => {
    const result = workflowDefinitionSchema.safeParse(definition({ pinData: { nX: [] } }));
    expect(result.success).toBe(false);
  });

  it('FR-013: rejeita configurações de nó fora do domínio', () => {
    const base = definition();
    const result = workflowDefinitionSchema.safeParse({
      ...base,
      nodes: base.nodes.map((n) => ({ ...n, settings: { onError: 'ignorar' } })),
    });
    expect(result.success).toBe(false);
  });

  it('FR-013: item exige json como objeto e aceita binário por referência', () => {
    expect(itemSchema.safeParse({ json: [] }).success).toBe(false);
    expect(
      itemSchema.safeParse({
        json: {},
        binary: { arquivo: { id: 'obj/1', mimeType: 'application/pdf', size: 10 } },
        pairedItem: { item: 0 },
      }).success,
    ).toBe(true);
  });
});
