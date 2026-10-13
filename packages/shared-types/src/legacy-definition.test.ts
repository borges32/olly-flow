import { describe, expect, it } from 'vitest';
import { migrateLegacyAgentixPayload, migrateLegacyDefinition } from './legacy-definition.js';
import type { WorkflowDefinition } from './workflow.js';

const def = (params: Record<string, unknown>): WorkflowDefinition => ({
  nodes: [{ id: 'a', type: 'ai.agentix', name: 'Agentix', params, position: [0, 0] }],
  edges: [],
  settings: {},
});

describe('spec 016 — FR-007 (13/10/2026): Agentix salvo antes do payload por propriedades', () => {
  it('FR-007: sem `payloadMode`, o nó fica no JSON; com o modo, não muda (idempotente)', () => {
    const legacy = migrateLegacyAgentixPayload(def({ payload: '{"pergunta": "x"}' }));
    expect(legacy.changed).toBe(true);
    expect(legacy.definition.nodes[0]?.params).toEqual({
      payload: '{"pergunta": "x"}',
      payloadMode: 'json',
    });
    const current = def({ payloadMode: 'fields', payloadFields: [] });
    expect(migrateLegacyAgentixPayload(current)).toEqual({ definition: current, changed: false });
    expect(migrateLegacyDefinition(legacy.definition).changed).toBe(false);
  });
});
