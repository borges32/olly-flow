import { createNodeRegistry } from '@olly/nodes';
import type { Edge, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { expressionsInStaticParams, numbersOutOfRange, validateWorkflow } from './validate.js';

const registry = createNodeRegistry();

const node = (id: string, type = 'data.set', name = id): WorkflowNode => ({
  id,
  type,
  name,
  params: {},
  position: [0, 0],
});
const edge = (from: string, to: string, fromPort = 'main', toPort = 'main'): Edge => ({
  id: `${from}-${to}-${fromPort}-${toPort}`,
  from,
  fromPort,
  to,
  toPort,
});
const def = (nodes: WorkflowNode[], edges: Edge[]): WorkflowDefinition => ({
  nodes,
  edges,
  settings: {},
});

describe('spec 002 — FR-004/FR-005: validação estrutural ao salvar', () => {
  it('FR-004: workflow válido não tem erros nem avisos', () => {
    const result = validateWorkflow(
      def([node('t', 'trigger.manual'), node('s')], [edge('t', 's')]),
      registry,
    );
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('FR-004/FR-005: conexão para nó inexistente identifica o nó existente', () => {
    const { errors } = validateWorkflow(
      def([node('t', 'trigger.manual')], [edge('t', 'fantasma')]),
      registry,
    );
    expect(errors).toEqual([
      expect.objectContaining({ code: 'EDGE_UNKNOWN_NODE', nodeIds: ['t'] }) as unknown,
    ]);
  });

  it('FR-004/FR-005: conexão para porta inexistente identifica os dois nós', () => {
    const { errors } = validateWorkflow(
      def([node('t', 'trigger.manual'), node('s')], [edge('t', 's', 'true', 'main')]),
      registry,
    );
    expect(errors.map((e) => [e.code, e.nodeIds])).toEqual([['EDGE_UNKNOWN_PORT', ['t', 's']]]);
    expect(errors[0]?.message).toContain('não tem a saída "true"');
  });

  it('FR-004/FR-005: nomes duplicados apontam todos os nós com o nome', () => {
    const { errors } = validateWorkflow(
      def(
        [node('t', 'trigger.manual'), node('a', 'data.set', 'X'), node('b', 'data.set', 'X')],
        [edge('t', 'a'), edge('t', 'b')],
      ),
      registry,
    );
    expect(errors.map((e) => [e.code, e.nodeIds])).toEqual([['DUPLICATE_NODE_NAME', ['a', 'b']]]);
  });

  it('FR-004/FR-005: ciclo lista os nós do ciclo', () => {
    const { errors } = validateWorkflow(
      def(
        [node('t', 'trigger.manual'), node('a'), node('b'), node('c')],
        [edge('t', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
      ),
      registry,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'INVALID_CYCLE', nodeIds: ['a', 'b', 'c'] });
  });

  it('FR-004: laço de um nó para ele mesmo é ciclo', () => {
    const { errors } = validateWorkflow(
      def([node('t', 'trigger.manual'), node('a')], [edge('t', 'a'), edge('a', 'a')]),
      registry,
    );
    expect(errors.map((e) => [e.code, e.nodeIds])).toEqual([['INVALID_CYCLE', ['a']]]);
  });

  it('FR-004: tipo de nó desconhecido é erro', () => {
    const { errors } = validateWorkflow(def([node('x', 'nao.existe')], []), registry);
    expect(errors.map((e) => [e.code, e.nodeIds])).toEqual([['NODE_UNKNOWN_TYPE', ['x']]]);
  });

  it('FR-004: nó órfão gera apenas aviso', () => {
    const result = validateWorkflow(
      def([node('t', 'trigger.manual'), node('s'), node('solto')], [edge('t', 's')]),
      registry,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => [w.code, w.nodeIds])).toEqual([['ORPHAN_NODE', ['solto']]]);
  });

  it('FR-004: workflow com um único nó não gera aviso de órfão', () => {
    expect(validateWorkflow(def([node('t', 'trigger.manual')], []), registry).warnings).toEqual([]);
  });
});

describe('spec 004 — FR-012: parâmetro sem expressão', () => {
  it('FR-012: SQL do postgres.query iniciado por "=" é erro ao salvar', () => {
    const def = (query: string): WorkflowDefinition => ({
      nodes: [
        { id: 'q', type: 'postgres.query', name: 'Consulta', params: { query }, position: [0, 0] },
      ],
      edges: [],
      settings: {},
    });
    expect(validateWorkflow(def("={{ 'DROP TABLE x' }}"), registry).errors).toEqual([
      {
        code: 'EXPRESSION_NOT_ALLOWED',
        message: 'Nó "Consulta": o parâmetro "query" não aceita expressões',
        nodeIds: ['q'],
      },
    ]);
    expect(validateWorkflow(def('SELECT $1'), registry).errors).toEqual([]);
  });

  it('FR-012/FR-015: campos aninhados (colunas do postgres.write) também são verificados', () => {
    expect(
      expressionsInStaticParams(
        {
          properties: {
            columns: {
              properties: {
                values: { items: { properties: { column: { 'x-no-expression': true } } } },
              },
            },
          },
        },
        { columns: { values: [{ column: 'ok' }, { column: '={{ $json.c }}' }] } },
      ),
    ).toEqual(['columns.values[1].column']);
  });
});

describe('spec 007 — FR-001: números dentro da faixa do parâmetro', () => {
  const merge = (numberInputs: unknown): WorkflowDefinition => ({
    nodes: [
      {
        id: 'mg',
        type: 'logic.merge',
        name: 'Juntar',
        params: { mode: 'append', numberInputs },
        position: [0, 0],
      },
    ],
    edges: [],
    settings: {},
  });

  it('FR-001: Merge com mais de 10 entradas é erro ao salvar (o canvas não mostraria as demais)', () => {
    expect(validateWorkflow(merge(15), registry).errors).toEqual([
      {
        code: 'PARAM_OUT_OF_RANGE',
        message: 'Nó "Juntar": o parâmetro "numberInputs" deve estar entre 2 e 10 (recebido: 15)',
        nodeIds: ['mg'],
      },
    ]);
    expect(validateWorkflow(merge(1), registry).errors.map((e) => e.code)).toEqual([
      'PARAM_OUT_OF_RANGE',
    ]);
  });

  it('FR-001: dentro da faixa não é erro; expressões ficam para a execução', () => {
    expect(validateWorkflow(merge(10), registry).errors).toEqual([]);
    expect(validateWorkflow(merge(2), registry).errors).toEqual([]);
    expect(
      numbersOutOfRange(
        { properties: { limite: { type: 'integer', minimum: 1, maximum: 5 } } },
        { limite: '={{ 99 }}' },
      ),
    ).toEqual([]);
  });

  it('caminhos aninhados (listas e objetos) também são verificados', () => {
    expect(
      numbersOutOfRange(
        {
          properties: {
            regras: {
              items: { properties: { peso: { type: 'number', minimum: 0, maximum: 1 } } },
            },
          },
        },
        { regras: [{ peso: 0.5 }, { peso: 3 }] },
      ),
    ).toEqual([{ path: 'regras[1].peso', value: 3, minimum: 0, maximum: 1 }]);
  });
});
