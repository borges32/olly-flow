import { describe, expect, it } from 'vitest';
import { migrateLegacyOutputParser } from './legacy-output-parser.js';
import type { WorkflowDefinition } from './workflow.js';

const SCHEMA = '{"type":"object","required":["nota"]}';

const legacy = (): WorkflowDefinition => ({
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'agent',
      type: 'ai.agent',
      name: 'Agente',
      params: { promptSource: 'define', text: 'oi', outputParser: 'jsonSchema', schema: SCHEMA },
      position: [100, 0],
    },
    {
      id: 'chain',
      type: 'ai.chainLlm',
      name: 'Chain',
      params: { text: 'oi', outputParser: 'none', schema: SCHEMA },
      position: [300, 0],
    },
    // Nome que colide com o nome gerado.
    { id: 'x', type: 'data.set', name: 'Agente · formato', params: {}, position: [0, 0] },
  ],
  edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'agent', toPort: 'main' }],
  settings: {},
});

describe('spec 018 — FR-006: migração do JSON Schema no nó', () => {
  it('FR-006: schema no nó vira Structured Output Parser ligado, com autoFix; `none` só perde o parâmetro', () => {
    const { definition, changed } = migrateLegacyOutputParser(legacy());
    expect(changed).toBe(true);
    const byId = Object.fromEntries(definition.nodes.map((n) => [n.id, n]));
    expect(byId.agent?.params).toEqual({
      promptSource: 'define',
      text: 'oi',
      hasOutputParser: true,
    });
    expect(byId.chain?.params).toEqual({ text: 'oi' });
    expect(byId['agent-parser']).toMatchObject({
      type: 'outputParser.structured',
      name: 'Agente · formato 2',
      params: { schemaType: 'manual', inputSchema: SCHEMA, autoFix: true },
    });
    expect(definition.edges).toContainEqual({
      id: 'agent-parser-ai_outputParser',
      from: 'agent-parser',
      fromPort: 'ai_outputParser',
      to: 'agent',
      toPort: 'ai_outputParser',
    });
  });

  it('FR-006: idempotente e sem mudança quando não há formato antigo', () => {
    const once = migrateLegacyOutputParser(legacy()).definition;
    const twice = migrateLegacyOutputParser(once);
    expect(twice.changed).toBe(false);
    expect(twice.definition).toBe(once);
  });
});
