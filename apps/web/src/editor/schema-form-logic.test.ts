import type { JSONSchema7Definition } from '@olly/nodes';
import { describe, expect, it } from 'vitest';
import {
  asSchema,
  fieldKind,
  filterOptions,
  isFieldVisible,
  mcpArgumentsSchema,
  multiSelectKey,
  newArrayItem,
  rangeMessage,
  selectedValues,
  toggleSelected,
  type ParamSchema,
} from './schema-form-logic';

describe('spec 002 — FR-009: painel gerado pelo schema', () => {
  const siblings: Record<string, JSONSchema7Definition> = {
    modo: { type: 'string', enum: ['simples', 'avancado'], default: 'simples' },
  };

  it('FR-009: show exige que o campo irmão tenha um dos valores', () => {
    const field: ParamSchema = {
      type: 'string',
      'x-display-options': { show: { modo: ['avancado'] } },
    };
    expect(isFieldVisible(field, { modo: 'avancado' }, siblings)).toBe(true);
    expect(isFieldVisible(field, { modo: 'simples' }, siblings)).toBe(false);
  });

  it('FR-009: hide esconde quando o campo irmão tem um dos valores', () => {
    const field: ParamSchema = {
      type: 'string',
      'x-display-options': { hide: { modo: ['simples'] } },
    };
    expect(isFieldVisible(field, { modo: 'avancado' }, siblings)).toBe(true);
    expect(isFieldVisible(field, { modo: 'simples' }, siblings)).toBe(false);
  });

  it('FR-009: campo irmão sem valor usa o default do schema', () => {
    const field: ParamSchema = {
      type: 'string',
      'x-display-options': { show: { modo: ['simples'] } },
    };
    expect(isFieldVisible(field, {}, siblings)).toBe(true);
  });

  it('FR-009: sem x-display-options o campo é sempre visível', () => {
    expect(isFieldVisible({ type: 'string' }, {})).toBe(true);
  });

  it('FR-009: identifica os tipos de campo suportados', () => {
    expect(fieldKind({ type: 'string', enum: ['a'] })).toBe('enum');
    expect(fieldKind({ type: 'integer' })).toBe('number');
    expect(fieldKind({ type: 'boolean' })).toBe('boolean');
    expect(fieldKind({ type: 'object' })).toBe('object');
    expect(fieldKind({ type: 'array', items: { type: 'object' } })).toBe('array');
    expect(fieldKind({ type: 'array', items: { type: 'string' } })).toBe('unsupported');
  });

  it('FR-009: novo item de lista recebe os defaults', () => {
    expect(
      newArrayItem({
        type: 'object',
        properties: { name: { type: 'string' }, type: { type: 'string', default: 'string' } },
      }),
    ).toEqual({ name: '', type: 'string' });
  });
});

describe('spec 010 — FR-009: formulário a partir do inputSchema da tool MCP', () => {
  it('FR-009: campos do schema, com o nome como rótulo e os obrigatórios indicados', () => {
    const schema = mcpArgumentsSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        a: { type: 'number', description: 'Primeira parcela' },
        b: { type: 'number', title: 'Segunda' },
        nota: { type: 'string' },
      },
      required: ['a', 'b'],
    });
    expect(schema.type).toBe('object');
    expect(
      Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([k, v]) => [k, asSchema(v).title]),
      ),
    ).toEqual({ a: 'a *', b: 'Segunda *', nota: 'nota' });
    expect(fieldKind(asSchema(schema.properties?.a))).toBe('number');
    expect(asSchema(schema.properties?.a).description).toBe('Primeira parcela');
  });
});

describe('spec 007 — FR-001: faixa dos campos numéricos', () => {
  const entradas = { type: 'integer', minimum: 2, maximum: 10 } as ParamSchema;
  it('FR-001: avisa fora da faixa (ex.: 15 entradas no Merge)', () => {
    expect(rangeMessage(entradas, 15)).toBe('Use um valor entre 2 e 10.');
    expect(rangeMessage(entradas, 1)).toBe('Use um valor entre 2 e 10.');
    expect(rangeMessage({ type: 'number', minimum: 0 }, -1)).toBe('Use no mínimo 0.');
  });
  it('FR-001: dentro da faixa, vazio ou expressão, sem aviso', () => {
    expect(rangeMessage(entradas, 10)).toBeUndefined();
    expect(rangeMessage(entradas, undefined)).toBeUndefined();
    expect(rangeMessage(entradas, '={{ 20 }}')).toBeUndefined();
  });
});

describe('spec 011 — FR-007: seleção múltipla das tools MCP (`x-load-options` em lista)', () => {
  const item: ParamSchema = {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  };

  it('grava as escolhidas no formato da lista (`[{ name }]`), marcando e desmarcando', () => {
    const key = multiSelectKey(item);
    expect(key).toBe('name');
    const one = toggleSelected([], key, 'soma');
    expect(one).toEqual([{ name: 'soma' }]);
    const two = toggleSelected(one, key, 'subtrai');
    expect(two).toEqual([{ name: 'soma' }, { name: 'subtrai' }]);
    expect(toggleSelected(two, key, 'soma')).toEqual([{ name: 'subtrai' }]);
  });

  it('lê valores gravados antes (itens vazios ou repetidos são ignorados)', () => {
    expect(selectedValues([{ name: 'soma' }, { name: '' }, { name: 'soma' }, {}], 'name')).toEqual([
      'soma',
    ]);
    expect(selectedValues(undefined, 'name')).toEqual([]);
  });

  it('filtra as opções pelo nome ou pela descrição', () => {
    const options = [
      { value: 'soma', label: 'soma', description: 'Soma dois números' },
      { value: 'clima', label: 'clima', description: 'Previsão do tempo' },
    ];
    expect(filterOptions(options, 'NÚMEROS').map((o) => o.value)).toEqual(['soma']);
    expect(filterOptions(options, 'cli').map((o) => o.value)).toEqual(['clima']);
    expect(filterOptions(options, '  ')).toHaveLength(2);
  });
});
