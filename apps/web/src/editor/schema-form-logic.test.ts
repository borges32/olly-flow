import type { JSONSchema7Definition } from '@olly/nodes';
import { describe, expect, it } from 'vitest';
import {
  asSchema,
  fieldKind,
  isFieldVisible,
  mcpArgumentsSchema,
  newArrayItem,
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
