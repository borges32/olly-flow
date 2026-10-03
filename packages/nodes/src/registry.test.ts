import { describe, expect, it } from 'vitest';
import {
  InvalidNodeDefinitionError,
  NodeRegistry,
  builtinNodes,
  createNodeRegistry,
  type NodeDefinition,
} from './index.js';

function node(overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    type: 'data.exemplo',
    version: 1,
    displayName: 'Exemplo',
    description: 'Nó de teste',
    icon: 'box',
    category: 'data',
    inputs: [{ name: 'main', kind: 'main' }],
    outputs: [{ name: 'main', kind: 'main' }],
    paramsSchema: {
      type: 'object',
      properties: {
        modo: { type: 'string', enum: ['a', 'b'] },
        token: { type: 'string', 'x-secret': true } as Record<string, unknown>,
        valor: { type: 'number', 'x-display-options': { show: { modo: ['b'] } } } as Record<
          string,
          unknown
        >,
      },
      required: ['modo'],
      additionalProperties: false,
    },
    execute: (input) => Promise.resolve({ main: input.items }),
    ...overrides,
  };
}

function registrationError(def: NodeDefinition): InvalidNodeDefinitionError {
  try {
    new NodeRegistry().register(def);
  } catch (error) {
    if (error instanceof InvalidNodeDefinitionError) return error;
    throw error;
  }
  throw new Error('registro deveria ter falhado');
}

describe('FR-014: registro de nós valida o schema de parâmetros', () => {
  it('FR-014: todo nó da plataforma possui paramsSchema válido', () => {
    const registry = createNodeRegistry();
    expect(registry.list()).toHaveLength(builtinNodes.length);
  });

  it('FR-014: registra nó válido, com extensões x-secret e x-display-options', () => {
    const registry = new NodeRegistry();
    registry.register(node());
    expect(registry.get('data.exemplo')?.displayName).toBe('Exemplo');
  });

  it('FR-014: rejeita paramsSchema que viola o meta-schema', () => {
    const error = registrationError(
      node({ paramsSchema: { type: 'object', required: 'modo' } as never }),
    );
    expect(error.problems.join()).toMatch(/paramsSchema inválido/);
  });

  it('FR-014: rejeita paramsSchema cuja raiz não é objeto', () => {
    const error = registrationError(node({ paramsSchema: { type: 'string' } }));
    expect(error.problems).toContain('paramsSchema deve ter type "object" na raiz');
  });

  it('FR-014: rejeita palavra-chave desconhecida no paramsSchema', () => {
    const error = registrationError(
      node({
        paramsSchema: {
          type: 'object',
          properties: { a: { type: 'string', 'x-segredo': true } as Record<string, unknown> },
        },
      }),
    );
    expect(error.problems.join()).toMatch(/x-segredo/);
  });

  it('FR-014: rejeita $ref sem destino', () => {
    const error = registrationError(
      node({ paramsSchema: { type: 'object', properties: { a: { $ref: '#/definitions/nada' } } } }),
    );
    expect(error.problems.join()).toMatch(/paramsSchema inválido/);
  });

  it('FR-014: rejeita type, categoria e portas inválidos', () => {
    const error = registrationError(
      node({
        type: 'Exemplo',
        category: 'outra' as never,
        outputs: [
          { name: 'main', kind: 'main' },
          { name: 'main', kind: 'main' },
        ],
      }),
    );
    expect(error.problems).toEqual(
      expect.arrayContaining([
        'type "Exemplo" fora do padrão categoria.nome',
        'category "outra" desconhecida',
        'outputs: porta duplicada "main"',
      ]),
    );
  });

  it('FR-014: rejeita versão duplicada e resolve a versão mais recente', () => {
    const registry = new NodeRegistry();
    registry.register(node());
    registry.register(node({ version: 2, displayName: 'Exemplo v2' }));
    expect(() => {
      registry.register(node());
    }).toThrow(InvalidNodeDefinitionError);
    expect(registry.get('data.exemplo')?.version).toBe(2);
    expect(registry.get('data.exemplo', 1)?.displayName).toBe('Exemplo');
    expect(registry.get('data.inexistente')).toBeUndefined();
  });

  it('FR-014: list não expõe a função execute', () => {
    const registry = new NodeRegistry();
    registry.register(node());
    const [description] = registry.list();
    expect(description).toBeDefined();
    expect(description).not.toHaveProperty('execute');
  });
});
