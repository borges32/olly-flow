import type { Item, NodeOutput } from '@olly/shared-types';
import { set } from 'lodash-es';
import type { NodeContext, NodeExecuteInput } from '../../types.js';
import { NodeParameterError, errorJson, failedItem, itemErrorMode, settle } from '../../errors.js';
import { SET_FIELD_TYPES, type SetFieldType } from './definition.js';

interface SetField {
  name: string;
  type: SetFieldType;
  value?: unknown;
}

function isFieldType(value: unknown): value is SetFieldType {
  return (SET_FIELD_TYPES as readonly unknown[]).includes(value);
}

function parseFields(raw: unknown): SetField[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new NodeParameterError('fields', 'deve ser uma lista');
  return raw.map((f: unknown, i) => {
    const field = (f ?? {}) as { name?: unknown; type?: unknown; value?: unknown };
    if (typeof field.name !== 'string' || field.name.trim() === '') {
      throw new NodeParameterError(`fields[${i}].name`, 'nome do campo vazio');
    }
    const type = field.type ?? 'string';
    if (!isFieldType(type)) {
      throw new NodeParameterError(
        `fields[${i}].type`,
        `tipo desconhecido ${JSON.stringify(type)}`,
      );
    }
    return { name: field.name.trim(), type, value: field.value };
  });
}

/** Converte o valor para o tipo declarado, com mensagem que aponta o campo. */
export function convertValue(field: SetField): unknown {
  const { name, type, value } = field;
  const fail = (expected: string): never => {
    throw new NodeParameterError(name, `valor ${JSON.stringify(value)} não é ${expected}`);
  };
  switch (type) {
    case 'string':
      return value === undefined || value === null
        ? ''
        : typeof value === 'string'
          ? value
          : JSON.stringify(value);
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value !== 'string' || value.trim() === '') return fail('um número');
      const n = Number(value);
      return Number.isFinite(n) ? n : fail('um número');
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (s === 'true') return true;
      if (s === 'false') return false;
      return fail('um booleano (true ou false)');
    }
    case 'json': {
      if (typeof value !== 'string') return value ?? null;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return fail('um JSON válido');
      }
    }
  }
}

/**
 * `includeOtherFields` (padrão falso, como no N8N). Sem ele, vale o alias da spec 002:
 * `keepOnlySet: false` significa incluir os demais campos.
 */
function includeOtherFields(ctx: NodeContext, i: number): boolean {
  const include = ctx.getParam('includeOtherFields', i);
  if (include !== undefined) return include === true;
  const keepOnlySet = ctx.getParam('keepOnlySet', i);
  return keepOnlySet === undefined ? false : keepOnlySet !== true;
}

export function executeSet(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput> {
  return settle(() => setFields(input, ctx));
}

/**
 * Um item por entrada. Item que falha (expressão ou conversão): com `onError: continue`, vira
 * `{ error }` na saída; com `errorOutput` (spec 007, FR-013), vai para a saída `error`.
 */
function setFields(input: NodeExecuteInput, ctx: NodeContext): NodeOutput {
  const mode = itemErrorMode(ctx.node.settings);
  const main: Item[] = [];
  const failed: Item[] = [];
  input.items.forEach((item, i) => {
    try {
      const fields = parseFields(ctx.getParam('fields', i));
      const includeOthers = includeOtherFields(ctx, i);
      const json: Record<string, unknown> = includeOthers ? structuredClone(item.json) : {};
      for (const field of fields) set(json, field.name, convertValue(field));
      const result: Item = { json, pairedItem: { item: i } };
      if (includeOthers && item.binary) result.binary = item.binary;
      main.push(result);
    } catch (error) {
      if (mode === 'stop') throw error;
      if (mode === 'errorOutput') failed.push(failedItem(error, item.json, i));
      else main.push({ json: errorJson(error), pairedItem: { item: i } });
    }
  });
  return mode === 'errorOutput' ? { main, error: failed } : { main };
}
