/**
 * Laços estruturados (spec 007, FR-008, plan §2): um ciclo só é válido quando volta pela porta
 * `continue` de um nó de laço (While ou Loop Over Items) que é a única entrada do ciclo
 * (dominador). Usado pelo motor (validação e execução) e pelo editor (conexões e destaque).
 */

/** Tipos de nó que controlam um laço. */
export const LOOP_NODE_TYPES: readonly string[] = ['logic.while', 'logic.loopOverItems'];
/** Porta de entrada pela qual o corpo do laço volta ao nó de laço. */
export const LOOP_CONTINUE_PORT = 'continue';

export interface GraphEdge {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

export interface LoopInfo {
  /** Nó de laço (While/Loop Over Items) que controla o ciclo. */
  header: string;
  /** Nós do ciclo, incluindo o nó de laço. */
  members: Set<string>;
  /** Corpo: os membros sem o nó de laço. */
  body: Set<string>;
  /** Arestas de retorno (do corpo para a porta `continue`). */
  backEdges: Set<string>;
  /** Laço que contém este (laços aninhados). */
  parent?: string;
}

export interface InvalidCycle {
  nodeIds: string[];
  reason: string;
}

export interface LoopAnalysis {
  loops: LoopInfo[];
  invalid: InvalidCycle[];
  /** Todas as arestas de retorno válidas. */
  backEdges: Set<string>;
}

/** Componentes fortemente conexos com mais de um nó ou com laço próprio (Tarjan). */
export function stronglyConnected(
  nodeIds: readonly string[],
  edges: readonly { from: string; to: string }[],
): string[][] {
  const adjacency = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) adjacency.get(e.from)?.push(e.to);
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const strongConnect = (v: string): void => {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v) ?? 0, lowlink.get(w) ?? 0));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v) ?? 0, indices.get(w) ?? 0));
      }
    }
    if (lowlink.get(v) === indices.get(v)) {
      const component = new Set<string>();
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        component.add(w);
      } while (w !== v);
      const selfLoop = component.size === 1 && (adjacency.get(v) ?? []).includes(v);
      if (component.size > 1 || selfLoop)
        components.push(nodeIds.filter((id) => component.has(id)));
    }
  };
  for (const id of nodeIds) if (!indices.has(id)) strongConnect(id);
  return components;
}

/**
 * Encontra os laços válidos e os ciclos inválidos. Laços aninhados são analisados de forma
 * recursiva, removendo as arestas de retorno do laço externo.
 */
export function analyzeLoops(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[],
  isLoopNode: (nodeId: string) => boolean,
  names: (nodeId: string) => string = (id) => id,
): LoopAnalysis {
  const loops: LoopInfo[] = [];
  const invalid: InvalidCycle[] = [];
  const backEdges = new Set<string>();

  const visit = (ids: readonly string[], scopeEdges: readonly GraphEdge[], parent?: string) => {
    for (const component of stronglyConnected(ids, scopeEdges)) {
      const members = new Set(component);
      const inside = scopeEdges.filter((e) => members.has(e.from) && members.has(e.to));
      const entering = scopeEdges.filter((e) => !members.has(e.from) && members.has(e.to));
      // O nó de laço do ciclo: recebe a volta pela `continue` e nenhuma outra conexão interna
      // (um laço aninhado recebe conexão do corpo externo pela entrada principal).
      const headers = component.filter(
        (id) =>
          isLoopNode(id) &&
          inside.some((e) => e.to === id && e.toPort === LOOP_CONTINUE_PORT) &&
          inside.every((e) => e.to !== id || e.toPort === LOOP_CONTINUE_PORT),
      );
      const list = component.map((id) => `"${names(id)}"`).join(', ');
      if (headers.length !== 1) {
        invalid.push({
          nodeIds: component,
          reason:
            headers.length === 0
              ? `Ciclo inválido entre ${list}: um ciclo só é permitido voltando pela entrada "continue" de um nó While ou Loop Over Items`
              : `Ciclo inválido entre ${list}: não há um único nó de laço que controle o ciclo; aninhe os laços`,
        });
        continue;
      }
      const header = headers[0] as string;
      const wrongEntry = entering.find((e) => e.to !== header || e.toPort === LOOP_CONTINUE_PORT);
      if (wrongEntry) {
        invalid.push({
          nodeIds: component,
          reason: `Ciclo inválido entre ${list}: o laço só pode receber conexões de fora pelo nó "${names(header)}" (entrada principal)`,
        });
        continue;
      }
      const back = inside.filter((e) => e.to === header && e.toPort === LOOP_CONTINUE_PORT);
      for (const e of back) backEdges.add(e.id);
      loops.push({
        header,
        members,
        body: new Set(component.filter((id) => id !== header)),
        backEdges: new Set(back.map((e) => e.id)),
        ...(parent !== undefined && { parent }),
      });
      const backIds = new Set(back.map((e) => e.id));
      visit(
        component,
        inside.filter((e) => !backIds.has(e.id)),
        header,
      );
    }
  };
  visit(nodeIds, edges);
  // Laços aninhados: o pai é o menor laço que contém o nó de laço.
  for (const loop of loops) {
    const containing = loops
      .filter((l) => l !== loop && l.members.has(loop.header) && l.header !== loop.header)
      .sort((a, b) => a.members.size - b.members.size);
    if (containing[0]) loop.parent = containing[0].header;
  }
  return { loops, invalid, backEdges };
}
