import type { Item } from '@olly/shared-types';
import { NodeExecutionError } from '../../errors.js';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const RETURN_ERROR = 'O código deve retornar um objeto ou array de objetos';

function toItem(value: unknown, where: string): Item {
  if (!isObject(value)) {
    throw new NodeExecutionError(RETURN_ERROR, {
      description: `${where} é ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`,
    });
  }
  // `{ json }` (formato do N8N) é mantido; qualquer outro objeto vira o `json` do item.
  if (isObject(value.json)) {
    return {
      json: value.json,
      ...(isObject(value.binary) && { binary: value.binary as Item['binary'] }),
    };
  }
  return { json: value };
}

/**
 * Normaliza o retorno do código em itens (spec 005, FR-011): objeto → um item; array de objetos
 * (com ou sem `json`) → um item por elemento. Outros tipos geram erro descritivo.
 */
export function normalizeItems(value: unknown): Item[] {
  if (Array.isArray(value)) return value.map((v, i) => toItem(v, `O elemento ${i} do retorno`));
  if (value === undefined) {
    throw new NodeExecutionError(RETURN_ERROR, {
      description: 'O código não retornou nada (use `return`)',
    });
  }
  return [toItem(value, 'O retorno')];
}
