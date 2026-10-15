import { describe, expect, it } from 'vitest';
import { migrateLegacyDefinition } from './legacy-definition.js';
import { migrateLegacyPostgres } from './legacy-postgres.js';
import type { WorkflowDefinition } from './workflow.js';

const definition: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'q',
      type: 'postgres.query',
      name: 'Consulta',
      params: {
        query: 'SELECT * FROM clientes WHERE id = $1',
        queryParameters: [{ value: '={{ $json.id }}' }],
        mode: 'perItem',
        options: { maxRows: 10 },
      },
      credentialId: 'cred-1',
      settings: { onError: 'continue' },
      position: [200, 0],
    },
    {
      id: 'w',
      type: 'postgres.write',
      name: 'Gravar',
      params: {
        operation: 'update',
        schema: 'public',
        table: 'clientes',
        columns: { mappingMode: 'autoMap', values: [] },
        matchingColumns: [{ column: 'id' }],
        options: { transaction: 'allItems' },
      },
      credentialId: 'cred-1',
      position: [400, 0],
    },
  ],
  edges: [
    { id: 'e1', from: 'm', fromPort: 'main', to: 'q', toPort: 'main' },
    { id: 'e2', from: 'q', fromPort: 'main', to: 'w', toPort: 'main' },
  ],
  settings: {},
  pinData: { q: [{ json: { id: 1 } }] },
};

describe('spec 022 — FR-008: migração dos nós PostgreSQL para o nó único', () => {
  it('FR-008: consulta e gravação viram o nó único com a operação, as opções renomeadas e o resto igual', () => {
    const { definition: migrated, changed } = migrateLegacyPostgres(definition);
    expect(changed).toBe(true);
    expect(migrated.nodes[1]).toEqual({
      id: 'q',
      type: 'postgres.database',
      name: 'Consulta',
      params: {
        operation: 'executeQuery',
        query: 'SELECT * FROM clientes WHERE id = $1',
        queryParameters: [{ value: '={{ $json.id }}' }],
        mode: 'perItem',
        queryOptions: { maxRows: 10 },
      },
      credentialId: 'cred-1',
      settings: { onError: 'continue' },
      position: [200, 0],
    });
    expect(migrated.nodes[2]).toMatchObject({
      type: 'postgres.database',
      params: {
        operation: 'update',
        table: 'clientes',
        matchingColumns: [{ column: 'id' }],
        writeOptions: { transaction: 'allItems' },
      },
    });
    expect(migrated.nodes[2]?.params).not.toHaveProperty('options');
    expect(migrated.edges).toEqual(definition.edges);
    expect(migrated.pinData).toEqual(definition.pinData);
  });

  it('FR-008: idempotente e incluída em migrateLegacyDefinition', () => {
    const once = migrateLegacyDefinition(definition).definition;
    expect(once.nodes.map((n) => n.type)).toEqual([
      'trigger.manual',
      'postgres.database',
      'postgres.database',
    ]);
    const twice = migrateLegacyDefinition(once);
    expect(twice.changed).toBe(false);
    expect(twice.definition).toEqual(once);
  });
});
