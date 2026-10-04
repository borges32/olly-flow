import type { JSONSchema7, JSONSchema7Definition } from '@olly/nodes';

/** `x-display-options`: equivalente ao `displayOptions` do N8N (ver docs/nos/README.md). */
export interface DisplayOptions {
  show?: Record<string, unknown[]>;
  hide?: Record<string, unknown[]>;
}

export type ParamSchema = JSONSchema7 & {
  'x-display-options'?: DisplayOptions;
  'x-secret'?: boolean;
  /** Parâmetro legado: aceito, mas não exibido. */
  'x-hidden'?: boolean;
};

export function asSchema(def: JSONSchema7Definition | undefined): ParamSchema {
  return typeof def === 'object' ? def : {};
}

/**
 * Campo visível dado o valor dos campos irmãos: todas as condições de `show` precisam bater e
 * nenhuma de `hide`. Campo irmão ausente usa o `default` do seu schema.
 */
export function isFieldVisible(
  field: ParamSchema,
  siblings: Record<string, unknown>,
  siblingSchemas: Record<string, JSONSchema7Definition> = {},
): boolean {
  const options = field['x-display-options'];
  if (!options) return true;
  const valueOf = (name: string): unknown =>
    siblings[name] ?? asSchema(siblingSchemas[name]).default;
  const matches = (name: string, allowed: unknown[]) => allowed.includes(valueOf(name));
  const show = Object.entries(options.show ?? {}).every(([name, allowed]) =>
    matches(name, allowed),
  );
  const hide = Object.entries(options.hide ?? {}).some(([name, allowed]) => matches(name, allowed));
  return show && !hide;
}

export type FieldKind =
  'enum' | 'string' | 'number' | 'boolean' | 'object' | 'array' | 'unsupported';

/** Subconjunto de JSON Schema suportado pelo painel (plan §7). */
export function fieldKind(schema: ParamSchema): FieldKind {
  if (schema.enum) return 'enum';
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    case 'array':
      return asSchema(schema.items as JSONSchema7Definition | undefined).type === 'object'
        ? 'array'
        : 'unsupported';
    default:
      return 'unsupported';
  }
}

/** Item novo de uma lista de objetos, com os defaults do schema. */
export function newArrayItem(itemSchema: ParamSchema): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(itemSchema.properties ?? {})) {
    const prop = asSchema(def);
    if (prop.default !== undefined) item[key] = structuredClone(prop.default);
    else if (prop.type === 'string') item[key] = '';
  }
  return item;
}
