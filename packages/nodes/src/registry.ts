import { Ajv } from 'ajv';
import { portDefSchema } from '@olly/shared-types';
import {
  NODE_CATEGORIES,
  PARAMS_SCHEMA_EXTENSIONS,
  type NodeDefinition,
  type NodeDescription,
} from './types.js';

export class InvalidNodeDefinitionError extends Error {
  constructor(
    readonly nodeType: string,
    readonly problems: string[],
  ) {
    super(`Definição de nó inválida (${nodeType}): ${problems.join('; ')}`);
    this.name = 'InvalidNodeDefinitionError';
  }
}

const TYPE_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

function createSchemaValidator(): Ajv {
  // strict: palavras-chave desconhecidas (ex.: erro de digitação) invalidam o schema.
  const ajv = new Ajv({ strict: true, allErrors: true });
  for (const keyword of PARAMS_SCHEMA_EXTENSIONS) ajv.addKeyword(keyword);
  return ajv;
}

function checkPorts(kind: 'inputs' | 'outputs', ports: unknown, problems: string[]): void {
  if (!Array.isArray(ports)) {
    problems.push(`${kind} deve ser uma lista`);
    return;
  }
  const names = new Set<string>();
  for (const port of ports as unknown[]) {
    const parsed = portDefSchema.safeParse(port);
    if (!parsed.success) {
      problems.push(`${kind}: porta inválida ${JSON.stringify(port)}`);
      continue;
    }
    const { name } = parsed.data;
    if (names.has(name)) problems.push(`${kind}: porta duplicada "${name}"`);
    names.add(name);
  }
}

function toDescription(definition: NodeDefinition): NodeDescription {
  const description: Partial<NodeDefinition> = { ...definition };
  delete description.execute;
  return description as NodeDescription;
}

export class NodeRegistry {
  private readonly nodes = new Map<string, Map<number, NodeDefinition>>();
  private readonly ajv = createSchemaValidator();

  /** Valida e registra o nó. Lança `InvalidNodeDefinitionError` se a definição for inválida. */
  register(definition: NodeDefinition): void {
    const problems = this.validate(definition);
    if (this.nodes.get(definition.type)?.has(definition.version)) {
      problems.push(`versão ${definition.version} já registrada`);
    }
    if (problems.length > 0) throw new InvalidNodeDefinitionError(definition.type, problems);

    const versions = this.nodes.get(definition.type) ?? new Map<number, NodeDefinition>();
    versions.set(definition.version, definition);
    this.nodes.set(definition.type, versions);
  }

  /** Retorna a versão pedida ou, se omitida, a mais recente. */
  get(type: string, version?: number): NodeDefinition | undefined {
    const versions = this.nodes.get(type);
    if (!versions) return undefined;
    if (version !== undefined) return versions.get(version);
    return versions.get(Math.max(...versions.keys()));
  }

  list(): NodeDescription[] {
    return [...this.nodes.values()]
      .flatMap((versions) => [...versions.values()])
      .map(toDescription)
      .sort((a, b) => a.type.localeCompare(b.type) || a.version - b.version);
  }

  private validate(def: NodeDefinition): string[] {
    const problems: string[] = [];
    if (!TYPE_PATTERN.test(def.type))
      problems.push(`type "${def.type}" fora do padrão categoria.nome`);
    if (!Number.isInteger(def.version) || def.version < 1)
      problems.push('version deve ser inteiro ≥ 1');
    if (!def.displayName.trim()) problems.push('displayName vazio');
    if (!(NODE_CATEGORIES as readonly string[]).includes(def.category)) {
      problems.push(`category "${def.category}" desconhecida`);
    }
    if (typeof def.execute !== 'function') problems.push('execute ausente');
    checkPorts('inputs', def.inputs, problems);
    checkPorts('outputs', def.outputs, problems);
    problems.push(...this.validateParamsSchema(def));
    return problems;
  }

  private validateParamsSchema(def: NodeDefinition): string[] {
    const schema: unknown = def.paramsSchema;
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
      return ['paramsSchema deve ser um objeto JSON Schema'];
    }
    if ((schema as { type?: unknown }).type !== 'object') {
      return ['paramsSchema deve ter type "object" na raiz'];
    }
    if (!this.ajv.validateSchema(schema)) {
      return [`paramsSchema inválido: ${this.ajv.errorsText(this.ajv.errors)}`];
    }
    try {
      // Compilar detecta o que o meta-schema não pega: $ref sem destino, palavras-chave desconhecidas.
      this.ajv.compile(schema);
    } catch (error) {
      return [`paramsSchema inválido: ${error instanceof Error ? error.message : String(error)}`];
    }
    return [];
  }
}
