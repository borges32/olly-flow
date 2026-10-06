import {
  LOOP_NODE_TYPES,
  analyzeLoops,
  resolveNodePorts,
  type WorkflowDefinition,
} from '@olly/shared-types';
import { TOOL_NAME_PATTERN, toolNameOf, type NodeDefinition, type NodeRegistry } from '@olly/nodes';

export type IssueCode =
  | 'NODE_UNKNOWN_TYPE'
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_NODE_NAME'
  | 'EDGE_UNKNOWN_NODE'
  | 'EDGE_UNKNOWN_PORT'
  | 'INVALID_CYCLE'
  | 'ORPHAN_NODE'
  | 'EXPRESSION_NOT_ALLOWED'
  // Spec 011, FR-001/FR-007: sub-nós do Agent e ferramentas.
  | 'SUBNODE_ON_MAIN'
  | 'AGENT_MODEL_REQUIRED'
  | 'AGENT_MEMORY_MAX'
  | 'TOOL_NAME_INVALID'
  | 'TOOL_NAME_DUPLICATE'
  | 'TOOL_DESCRIPTION_REQUIRED'
  // Spec 007, FR-001 (e todo parâmetro numérico com faixa no schema).
  | 'PARAM_OUT_OF_RANGE';

export interface Issue {
  code: IssueCode;
  message: string;
  /** Nós envolvidos (FR-005): o editor os destaca. */
  nodeIds: string[];
}

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
}

type SchemaNode = {
  type?: unknown;
  properties?: Record<string, unknown>;
  items?: unknown;
  minimum?: number;
  maximum?: number;
  'x-no-expression'?: boolean;
};

export interface OutOfRange {
  path: string;
  value: number;
  minimum?: number;
  maximum?: number;
}

/**
 * Números fixos fora de `minimum`/`maximum` do schema, percorrendo objetos e listas. Expressões
 * (texto iniciado por `=`) só têm valor na execução e não são verificadas aqui.
 */
export function numbersOutOfRange(schema: unknown, value: unknown, path = ''): OutOfRange[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const s = schema as SchemaNode;
  if (typeof value === 'number') {
    const low = typeof s.minimum === 'number' && value < s.minimum;
    const high = typeof s.maximum === 'number' && value > s.maximum;
    return low || high
      ? [
          {
            path,
            value,
            ...(s.minimum !== undefined && { minimum: s.minimum }),
            ...(s.maximum !== undefined && { maximum: s.maximum }),
          },
        ]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => numbersOutOfRange(s.items, v, `${path}[${String(i)}]`));
  }
  if (typeof value === 'object' && value !== null && s.properties) {
    return Object.entries(s.properties).flatMap(([key, sub]) =>
      numbersOutOfRange(
        sub,
        (value as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      ),
    );
  }
  return [];
}

const rangeText = (r: OutOfRange) =>
  r.minimum !== undefined && r.maximum !== undefined
    ? `entre ${String(r.minimum)} e ${String(r.maximum)}`
    : r.minimum !== undefined
      ? `no mínimo ${String(r.minimum)}`
      : `no máximo ${String(r.maximum)}`;

/**
 * Caminhos de parâmetros marcados com `x-no-expression` que receberam uma expressão (valor
 * iniciado por `=`), percorrendo objetos e listas (spec 004, FR-012).
 */
export function expressionsInStaticParams(schema: unknown, value: unknown, path = ''): string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const s = schema as SchemaNode;
  if (s['x-no-expression'] && typeof value === 'string' && value.startsWith('=')) return [path];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => expressionsInStaticParams(s.items, v, `${path}[${i}]`));
  }
  if (typeof value === 'object' && value !== null && s.properties) {
    return Object.entries(s.properties).flatMap(([key, sub]) =>
      expressionsInStaticParams(
        sub,
        (value as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      ),
    );
  }
  return [];
}

/**
 * Validação estrutural ao salvar (FR-004). Erros impedem o salvamento; avisos não.
 * A forma do JSON é validada antes pelo schema zod de `@olly/shared-types`.
 */
export function validateWorkflow(
  def: WorkflowDefinition,
  registry: NodeRegistry,
): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const nodesById = new Map(def.nodes.map((n) => [n.id, n]));

  const byId = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  for (const node of def.nodes) {
    byId.set(node.id, [...(byId.get(node.id) ?? []), node.id]);
    byName.set(node.name, [...(byName.get(node.name) ?? []), node.id]);
    const type = registry.get(node.type);
    if (!type) {
      errors.push({
        code: 'NODE_UNKNOWN_TYPE',
        message: `Nó "${node.name}": tipo desconhecido "${node.type}"`,
        nodeIds: [node.id],
      });
    }
    for (const path of expressionsInStaticParams(type?.paramsSchema, node.params)) {
      errors.push({
        code: 'EXPRESSION_NOT_ALLOWED',
        message: `Nó "${node.name}": o parâmetro "${path}" não aceita expressões`,
        nodeIds: [node.id],
      });
    }
    for (const r of numbersOutOfRange(type?.paramsSchema, node.params)) {
      errors.push({
        code: 'PARAM_OUT_OF_RANGE',
        message: `Nó "${node.name}": o parâmetro "${r.path}" deve estar ${rangeText(r)} (recebido: ${String(r.value)})`,
        nodeIds: [node.id],
      });
    }
  }
  for (const [id, ids] of byId) {
    if (ids.length > 1) {
      errors.push({
        code: 'DUPLICATE_NODE_ID',
        message: `Id de nó repetido: ${id}`,
        nodeIds: [id],
      });
    }
  }
  for (const [name, ids] of byName) {
    if (ids.length > 1) {
      errors.push({
        code: 'DUPLICATE_NODE_NAME',
        message: `Nome de nó repetido: "${name}"`,
        nodeIds: ids,
      });
    }
  }

  const validEdges: WorkflowDefinition['edges'] = [];
  for (const edge of def.edges) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) {
      const missing = [!from ? edge.from : null, !to ? edge.to : null].filter(
        (x): x is string => x !== null,
      );
      errors.push({
        code: 'EDGE_UNKNOWN_NODE',
        message: `Conexão ${edge.id} aponta para nó inexistente: ${missing.join(', ')}`,
        nodeIds: [from?.id, to?.id].filter((x): x is string => x !== undefined),
      });
      continue;
    }
    validEdges.push(edge);
    const fromType = registry.get(from.type);
    const toType = registry.get(to.type);
    // Portas efetivas: dinâmicas (Merge, Switch) e de erro (spec 007).
    if (
      fromType &&
      !resolveNodePorts(fromType, from).outputs.some((p) => p.name === edge.fromPort)
    ) {
      errors.push({
        code: 'EDGE_UNKNOWN_PORT',
        message: `Nó "${from.name}" não tem a saída "${edge.fromPort}"`,
        nodeIds: [from.id, to.id],
      });
    }
    if (toType && !resolveNodePorts(toType, to).inputs.some((p) => p.name === edge.toPort)) {
      errors.push({
        code: 'EDGE_UNKNOWN_PORT',
        message: `Nó "${to.name}" não tem a entrada "${edge.toPort}"`,
        nodeIds: [from.id, to.id],
      });
    }
    // Spec 011, FR-001: porta só se liga a porta do mesmo tipo (sub-nó nunca no fluxo principal).
    const fromKind =
      fromType &&
      resolveNodePorts(fromType, from).outputs.find((p) => p.name === edge.fromPort)?.kind;
    const toKind =
      toType && resolveNodePorts(toType, to).inputs.find((p) => p.name === edge.toPort)?.kind;
    if (fromKind && toKind && fromKind !== toKind) {
      errors.push({
        code: 'SUBNODE_ON_MAIN',
        message: `Conexão de "${from.name}" para "${to.name}" liga portas de tipos diferentes`,
        nodeIds: [from.id, to.id],
      });
    }
  }

  errors.push(...validateSubNodes(def, validEdges, registry));

  // Spec 007, FR-008: ciclos só pela porta `continue` de um nó de laço que domina o ciclo.
  const { invalid } = analyzeLoops(
    [...nodesById.keys()],
    validEdges,
    (id) => LOOP_NODE_TYPES.includes(nodesById.get(id)?.type ?? ''),
    (id) => nodesById.get(id)?.name ?? id,
  );
  for (const cycle of invalid) {
    errors.push({ code: 'INVALID_CYCLE', message: cycle.reason, nodeIds: cycle.nodeIds });
  }

  if (def.nodes.length > 1) {
    const connected = new Set(validEdges.flatMap((e) => [e.from, e.to]));
    for (const node of def.nodes) {
      if (!connected.has(node.id)) {
        warnings.push({
          code: 'ORPHAN_NODE',
          message: `Nó "${node.name}" não está conectado`,
          nodeIds: [node.id],
        });
      }
    }
  }

  return { errors, warnings };
}

/**
 * Spec 011, FR-001/FR-007: o Agent exige exatamente 1 modelo e no máximo 1 memória (portas
 * obrigatórias e com limite de conexões); as ferramentas ligadas a um nó têm nome válido e
 * único e descrição obrigatória.
 */
function validateSubNodes(
  def: WorkflowDefinition,
  edges: WorkflowDefinition['edges'],
  registry: NodeRegistry,
): Issue[] {
  const issues: Issue[] = [];
  const nodesById = new Map(def.nodes.map((n) => [n.id, n]));
  for (const node of def.nodes) {
    const type = registry.get(node.type);
    if (!type) continue;
    for (const port of resolveNodePorts(type, node).inputs) {
      if (port.kind === 'main') continue;
      const connected = edges.filter((e) => e.to === node.id && e.toPort === port.name);
      const label = port.displayName ?? port.name;
      if (port.required && connected.length === 0) {
        issues.push({
          code: 'AGENT_MODEL_REQUIRED',
          message: `Nó "${node.name}": conecte ${label.toLowerCase()} (obrigatório)`,
          nodeIds: [node.id],
        });
      }
      if (port.maxConnections !== undefined && connected.length > port.maxConnections) {
        issues.push({
          code: port.kind === 'ai_memory' ? 'AGENT_MEMORY_MAX' : 'AGENT_MODEL_REQUIRED',
          message: `Nó "${node.name}": no máximo ${String(port.maxConnections)} conexão(ões) em ${label.toLowerCase()}`,
          nodeIds: [node.id, ...connected.map((e) => e.from)],
        });
      }
      if (port.kind !== 'ai_tool') continue;
      const names = new Map<string, string[]>();
      for (const edge of connected) {
        const tool = nodesById.get(edge.from);
        const toolType = tool && registry.get(tool.type);
        if (!tool || !toolType || !hasToolName(toolType)) continue;
        const name = toolNameOf(tool);
        if (!TOOL_NAME_PATTERN.test(name)) {
          issues.push({
            code: 'TOOL_NAME_INVALID',
            message: `Ferramenta "${tool.name}": nome "${name}" inválido (letras, números, _ e -, até 64)`,
            nodeIds: [tool.id],
          });
        }
        const description = tool.params.toolDescription;
        if (typeof description !== 'string' || description.trim() === '') {
          issues.push({
            code: 'TOOL_DESCRIPTION_REQUIRED',
            message: `Ferramenta "${tool.name}": descreva para o modelo o que ela faz`,
            nodeIds: [tool.id],
          });
        }
        names.set(name, [...(names.get(name) ?? []), tool.id]);
      }
      for (const [name, ids] of names) {
        if (ids.length > 1) {
          issues.push({
            code: 'TOOL_NAME_DUPLICATE',
            message: `Nó "${node.name}": mais de uma ferramenta com o nome "${name}"`,
            nodeIds: ids,
          });
        }
      }
    }
  }
  return issues;
}

const hasToolName = (type: NodeDefinition) =>
  type.outputs.some((p) => p.kind === 'ai_tool') &&
  Object.hasOwn(type.paramsSchema.properties ?? {}, 'toolName');
