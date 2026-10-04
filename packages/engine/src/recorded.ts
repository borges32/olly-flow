import type { Item, NodeOutput, WorkflowDefinition } from '@olly/shared-types';
import type { RunView, SourceRef } from './state.js';

export interface RecordedNode {
  nodeId: string;
  status: string;
  inputs: Record<string, Item[]> | null;
  inputSources: Record<string, SourceRef[]> | null;
  output: NodeOutput | null;
}

/** Execução reconstruída a partir do log (preview de expressões sobre a última execução). */
export class RecordedRun implements RunView {
  private readonly byId: Map<string, RecordedNode>;
  private readonly overrides = new Map<
    string,
    { inputs: Record<string, Item[]>; sources: Record<string, SourceRef[]> }
  >();

  constructor(nodes: RecordedNode[]) {
    this.byId = new Map(nodes.map((n) => [n.nodeId, n]));
  }

  /** Define a entrada de um nó (ex.: nó que não rodou nessa execução). */
  setInputs(
    nodeId: string,
    inputs: Record<string, Item[]>,
    sources: Record<string, SourceRef[]>,
  ): void {
    this.overrides.set(nodeId, { inputs, sources });
  }

  inputsOf(nodeId: string): Record<string, Item[]> | undefined {
    return this.overrides.get(nodeId)?.inputs ?? this.byId.get(nodeId)?.inputs ?? undefined;
  }

  sourcesOf(nodeId: string): Record<string, SourceRef[]> | undefined {
    return this.overrides.get(nodeId)?.sources ?? this.byId.get(nodeId)?.inputSources ?? undefined;
  }

  outputOf(nodeId: string): NodeOutput | undefined {
    return this.byId.get(nodeId)?.output ?? undefined;
  }

  isExecuted(nodeId: string): boolean {
    return this.byId.get(nodeId)?.status === 'success';
  }
}

/** Entrada que um nó receberia dos pais já executados, na ordem das arestas (como o motor entrega). */
export function collectInputs(
  def: WorkflowDefinition,
  view: RunView,
  nodeId: string,
): { inputs: Record<string, Item[]>; sources: Record<string, SourceRef[]> } {
  const inputs: Record<string, Item[]> = {};
  const sources: Record<string, SourceRef[]> = {};
  for (const edge of def.edges) {
    if (edge.to !== nodeId) continue;
    const items = view.outputOf(edge.from)?.[edge.fromPort] ?? [];
    inputs[edge.toPort] = [...(inputs[edge.toPort] ?? []), ...items];
    sources[edge.toPort] = [
      ...(sources[edge.toPort] ?? []),
      ...items.map((_, index) => ({ nodeId: edge.from, port: edge.fromPort, index })),
    ];
  }
  return { inputs, sources };
}
