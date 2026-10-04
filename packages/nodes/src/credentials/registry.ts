import { Ajv, type ValidateFunction } from 'ajv';
import { PARAMS_SCHEMA_EXTENSIONS, type JSONSchema7 } from '../types.js';
import { builtinCredentialTypes, type CredentialTypeDefinition } from './definitions.js';

/** Visão pública de um tipo (ex.: `GET /credential-types`). */
export type CredentialTypeDescription = CredentialTypeDefinition;

const isSecret = (schema: unknown) =>
  typeof schema === 'object' && schema !== null && (schema as Record<string, unknown>)['x-secret'];

/** Tipos de credencial com validação dos dados e tratamento dos campos secretos (plan §2, §3). */
export class CredentialTypeRegistry {
  private readonly types = new Map<string, CredentialTypeDefinition>();
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly ajv: Ajv;

  constructor(types: readonly CredentialTypeDefinition[] = builtinCredentialTypes) {
    // useDefaults: campos omitidos recebem o padrão do tipo (ex.: porta 5432).
    this.ajv = new Ajv({ strict: true, allErrors: true, useDefaults: true });
    for (const keyword of PARAMS_SCHEMA_EXTENSIONS) this.ajv.addKeyword(keyword);
    for (const type of types) {
      this.types.set(type.name, type);
      this.validators.set(type.name, this.ajv.compile(type.properties));
    }
  }

  get(name: string): CredentialTypeDefinition | undefined {
    return this.types.get(name);
  }

  list(): CredentialTypeDescription[] {
    return [...this.types.values()];
  }

  secretFields(name: string): string[] {
    const props = this.types.get(name)?.properties.properties ?? {};
    return Object.entries(props)
      .filter(([, schema]) => isSecret(schema))
      .map(([field]) => field);
  }

  /** Dados sem os campos secretos (DTO de saída, FR-002). */
  publicFields(name: string, data: Record<string, unknown>): Record<string, unknown> {
    const secrets = new Set(this.secretFields(name));
    return Object.fromEntries(Object.entries(data).filter(([field]) => !secrets.has(field)));
  }

  /** Edição: campo secreto ausente ou vazio mantém o valor atual (HU-1.1). */
  merge(
    name: string,
    current: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged = { ...current, ...incoming };
    for (const field of this.secretFields(name)) {
      const value = incoming[field];
      if (value === undefined || value === null || value === '') merged[field] = current[field];
    }
    return merged;
  }

  /** Valida (aplicando padrões); devolve os dados normalizados ou a lista de problemas. */
  validate(
    name: string,
    data: Record<string, unknown>,
  ): { ok: true; data: Record<string, unknown> } | { ok: false; problems: string[] } {
    const validator = this.validators.get(name);
    if (!validator) return { ok: false, problems: [`tipo de credencial desconhecido: ${name}`] };
    const copy = structuredClone(data);
    if (validator(copy)) return { ok: true, data: copy };
    // Mensagens citam o campo, nunca o valor (o valor pode ser secreto).
    return {
      ok: false,
      problems: (validator.errors ?? []).map((e) => {
        const field =
          e.instancePath.replace(/^\//, '') ||
          (e.params as { missingProperty?: string }).missingProperty ||
          'dados';
        return `${field}: ${e.message ?? 'inválido'}`;
      }),
    };
  }

  /**
   * Valores que não podem aparecer em dados gravados, logs ou erros (FR-003): os campos
   * secretos e formas derivadas conhecidas (Basic em base64).
   */
  secretValues(name: string, data: Record<string, unknown>): string[] {
    const values = this.secretFields(name)
      .map((field) => data[field])
      .filter((v): v is string => typeof v === 'string' && v !== '');
    if (
      name === 'httpBasic' &&
      typeof data.user === 'string' &&
      typeof data.password === 'string'
    ) {
      values.push(Buffer.from(`${data.user}:${data.password}`).toString('base64'));
    }
    return values;
  }
}

export type { JSONSchema7 };
