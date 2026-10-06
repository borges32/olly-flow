import type { NodeRegistry } from '@olly/nodes';
import { resolveNodePorts } from '@olly/shared-types';
import {
  ExpressionError,
  collectExpressions,
  findNodeReferences,
  type NodeReferences,
  pathToString,
  snippetOf,
  substitute,
  type EvaluateResult,
  type ExpressionData,
  type ExpressionEvaluator,
  type ReferencedNodeData,
} from '@olly/expressions';
import type { Item, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { resolvePairedItem } from './paired.js';
import type { RunView } from './state.js';

export interface ExpressionScope {
  executionId: string;
  mode: 'test' | 'production';
  workflow: { id: string; name: string; active: boolean };
  vars: Record<string, unknown>;
  env: Record<string, string>;
  timezone: string;
  /** Spec 007, FR-007: laço mais interno que contém o nó. */
  loop?: { index: number; maxIterations: number; accumulated: Item[] };
  /** Spec 011, FR-007: valores de `$fromAI()` (chamada de ferramenta pelo modelo). */
  fromAI?: Record<string, unknown>;
}

/** Devolve o parâmetro resolvido para o item, ou lança `ExpressionError`. */
export type ParamResolver = (name: string, itemIndex: number) => unknown;

/** Contexto copiado para o sandbox: só os nós referenciados pelas expressões (plan §2). */
export function buildExpressionData(
  def: WorkflowDefinition,
  registry: NodeRegistry,
  view: RunView,
  node: WorkflowNode,
  input: Item[],
  templates: string[],
  scope: ExpressionScope,
  /** Referências já calculadas (ex.: do código do nó `code.javascript`, spec 005). */
  references?: NodeReferences,
): ExpressionData {
  const refs = references ?? findNodeReferences(templates);
  const byName = new Map(def.nodes.map((n) => [n.name, n]));
  const names = refs.dynamic
    ? def.nodes.filter((n) => view.isExecuted(n.id)).map((n) => n.name)
    : [...refs.names];

  const nodes: Record<string, ReferencedNodeData> = {};
  for (const name of names) {
    const ref = byName.get(name);
    if (!ref) continue;
    const refType = registry.get(ref.type);
    nodes[name] = {
      executed: view.isExecuted(ref.id),
      outputs: view.outputOf(ref.id) ?? {},
      outputOrder: refType ? resolveNodePorts(refType, ref).outputs.map((p) => p.name) : ['main'],
      params: ref.params,
    };
  }

  const itemCount = Math.max(1, input.length);
  const paired = Array.from({ length: itemCount }, (_, i) =>
    Object.fromEntries(
      Object.keys(nodes).flatMap((name) => {
        const ref = byName.get(name);
        if (!ref || !view.isExecuted(ref.id)) return [];
        return [[name, resolvePairedItem(def, registry, view, node.id, i, ref.id)]];
      }),
    ),
  );

  return {
    nodeName: node.name,
    params: node.params,
    input,
    nodes,
    paired,
    vars: structuredClone(scope.vars),
    env: scope.env,
    execution: { id: scope.executionId, mode: scope.mode },
    workflow: scope.workflow,
    timezone: scope.timezone,
    ...(scope.loop && { loop: structuredClone(scope.loop) }),
    ...(scope.fromAI && { fromAI: structuredClone(scope.fromAI) }),
  };
}

/**
 * Avalia em lote todas as expressões do nó para todos os itens (plan §4, NFR-002) e devolve
 * o resolvedor usado por `NodeContext.getParam`. Erros só aparecem quando o parâmetro é lido.
 */
export async function resolveNodeParams(
  def: WorkflowDefinition,
  registry: NodeRegistry,
  view: RunView,
  node: WorkflowNode,
  input: Item[],
  scope: ExpressionScope,
  evaluator: ExpressionEvaluator | undefined,
): Promise<ParamResolver> {
  const found = collectExpressions(node.params);
  const itemCount = Math.max(1, input.length);
  const checkIndex = (name: string, i: number) => {
    if (i < 0 || i >= itemCount) throw new Error(`Parâmetro "${name}": item ${i} inexistente`);
  };
  if (found.length === 0) {
    return (name, i) => {
      checkIndex(name, i);
      return structuredClone(node.params[name]);
    };
  }
  if (!evaluator) throw new Error('Este workflow usa expressões, mas não há avaliador configurado');

  const data = buildExpressionData(
    def,
    registry,
    view,
    node,
    input,
    found.map((f) => f.template),
    scope,
  );
  const requests = found.flatMap((f, k) =>
    Array.from({ length: itemCount }, (_, i) => ({
      id: `${k}:${i}`,
      template: f.template,
      itemIndex: i,
    })),
  );
  const results = new Map<string, EvaluateResult>(
    (await evaluator.evaluateBatch({ executionId: scope.executionId, data, requests })).map((r) => [
      r.id,
      r,
    ]),
  );
  const indexByPath = new Map(found.map((f, k) => [pathToString(f.path), k]));

  return (name, i) => {
    checkIndex(name, i);
    return substitute(
      node.params[name],
      (path) => {
        const key = pathToString(path);
        const k = indexByPath.get(key);
        const result = k === undefined ? undefined : results.get(`${k}:${i}`);
        if (!result) throw new Error(`Expressão sem resultado: ${key}`);
        if (result.ok) return result.value;
        throw new ExpressionError({
          nodeName: node.name,
          parameter: key,
          itemIndex: i,
          snippet: snippetOf(found[k ?? 0]?.template ?? ''),
          kind: result.error.kind,
          cause: result.error.message,
        });
      },
      [name],
    );
  };
}
