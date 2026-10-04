import type { JSONSchema7Definition } from '@olly/nodes';
import { describe, expect, it } from 'vitest';
import { fieldKind, isFieldVisible, newArrayItem, type ParamSchema } from './schema-form-logic';

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
