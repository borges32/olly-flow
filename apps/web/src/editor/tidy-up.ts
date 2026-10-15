import { Graph, layout } from '@dagrejs/dagre';
import type { Edge, WorkflowNode } from '@olly/shared-types';

export interface Size {
  width: number;
  height: number;
}

/** Tamanho usado quando o nó ainda não foi medido pelo canvas. */
export const DEFAULT_NODE_SIZE: Size = { width: 180, height: 80 };
/** Espaço entre o nó e a fileira dos seus sub-nós, e entre sub-nós vizinhos. */
export const SUBNODE_GAP_Y = 80;
export const SUBNODE_GAP_X = 40;

export interface TidyUpInput {
  nodes: WorkflowNode[];
  edges: Edge[];
  sizes: Record<string, Size | undefined>;
  /** Nó cujas saídas são todas de sub-nó (`ai_*`): modelo, memória, ferramenta, parser. */
  isSubNode: (node: WorkflowNode) => boolean;
  /** Conexão de um sub-nó com a entrada `ai_*` do nó pai. */
  isSubNodeEdge: (edge: Edge) => boolean;
  /** Entradas do nó, na ordem (ordena os sub-nós embaixo do pai). */
  inputOrder: (node: WorkflowNode) => string[];
  /** Saídas do nó, na ordem (os ramos do If e do Switch ficam na ordem das saídas). */
  outputOrder: (node: WorkflowNode) => string[];
  /** Ids selecionados no canvas. */
  selection: string[];
}

interface Block {
  id: string;
  width: number;
  height: number;
  /** Posições dos nós do bloco a partir do canto superior esquerdo dele. */
  place: (left: number, top: number, out: Record<string, [number, number]>) => void;
}

/**
 * Organiza os nós como o "Tidy up" do N8N (spec 023): da esquerda para a direita na ordem das
 * conexões (layout em camadas do dagre, com redução de cruzamentos), sem sobreposição, com os
 * sub-nós embaixo do nó pai. Com dois ou mais nós selecionados, só eles (e os sub-nós deles);
 * senão, todos. O canto superior esquerdo dos nós organizados fica onde estava. Devolve as
 * posições novas dos nós organizados.
 */
export function tidyUp(input: TidyUpInput): Record<string, [number, number]> {
  const { nodes, edges } = input;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sizeOf = (id: string): Size => input.sizes[id] ?? DEFAULT_NODE_SIZE;

  // Cada sub-nó fica com um só pai: o da primeira conexão (ex.: a memória ligada ao Agent e ao
  // Chat Trigger, spec 021).
  const parentOf = new Map<string, string>();
  for (const edge of edges) {
    const child = byId.get(edge.from);
    if (!child || !byId.has(edge.to) || parentOf.has(edge.from)) continue;
    if (input.isSubNode(child) && input.isSubNodeEdge(edge)) parentOf.set(edge.from, edge.to);
  }
  const childrenOf = (parentId: string): string[] => {
    const parent = byId.get(parentId);
    const order = parent ? input.inputOrder(parent) : [];
    const rank = (edge: Edge) => {
      const i = order.indexOf(edge.toPort);
      return i < 0 ? order.length : i;
    };
    const kids = edges
      .filter((e) => e.to === parentId && parentOf.get(e.from) === parentId)
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (byId.get(a.from)?.position[0] ?? 0) - (byId.get(b.from)?.position[0] ?? 0),
      )
      .map((e) => e.from);
    return [...new Set(kids)];
  };

  // Alvo (FR-003): a seleção com 2+ nós, com os sub-nós deles; senão, tudo.
  const selected = input.selection.filter((id) => byId.has(id));
  const roots = (selected.length >= 2 ? selected : nodes.map((n) => n.id)).filter((id) => {
    const parent = parentOf.get(id);
    // Sub-nó cujo pai também é organizado vai junto com o pai.
    return !parent || !(selected.length >= 2 ? selected.includes(parent) : true);
  });
  if (roots.length === 0) return {};

  const visiting = new Set<string>();
  /**
   * Bloco do nó com os sub-nós embaixo. No bloco de um nó do fluxo principal (`root`), a mesma
   * altura dos sub-nós sobra em cima: o nó fica no centro do bloco, na linha do fluxo (o dagre
   * alinha os centros), e os sub-nós "pendem" embaixo, como no N8N.
   */
  const blockOf = (id: string, root: boolean): Block => {
    visiting.add(id);
    const own = sizeOf(id);
    const kids = childrenOf(id)
      .filter((k) => !visiting.has(k))
      .map((k) => blockOf(k, false));
    const rowWidth =
      kids.reduce((sum, k) => sum + k.width, 0) + SUBNODE_GAP_X * Math.max(0, kids.length - 1);
    const rowHeight = kids.reduce((max, k) => Math.max(max, k.height), 0);
    const hanging = kids.length > 0 ? SUBNODE_GAP_Y + rowHeight : 0;
    const above = root ? hanging : 0;
    return {
      id,
      width: Math.max(own.width, rowWidth),
      height: above + own.height + hanging,
      place(left, top, out) {
        const nodeTop = top + above;
        out[id] = [left + (this.width - own.width) / 2, nodeTop];
        let x = left + (this.width - rowWidth) / 2;
        for (const kid of kids) {
          kid.place(x, nodeTop + own.height + SUBNODE_GAP_Y, out);
          x += kid.width + SUBNODE_GAP_X;
        }
      },
    };
  };
  const blocks = roots.map((id) => blockOf(id, true));
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const rootOf = new Map<string, string>();
  const collect = (rootId: string, id: string) => {
    rootOf.set(id, rootId);
    for (const kid of childrenOf(id)) if (!rootOf.has(kid)) collect(rootId, kid);
  };
  for (const b of blocks) collect(b.id, b.id);

  // Camadas da esquerda para a direita (FR-001); o dagre resolve os laços e as partes soltas.
  const graph = new Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const b of blocks) graph.setNode(b.id, { width: b.width, height: b.height });
  for (const edge of edges) {
    if (input.isSubNodeEdge(edge)) continue;
    const from = rootOf.get(edge.from);
    const to = rootOf.get(edge.to);
    if (from && to && from !== to) graph.setEdge(from, to);
  }
  layout(graph);
  const centers = new Map(
    blocks.map((b) => {
      const c = graph.node(b.id) as { x: number; y: number };
      return [b.id, { x: c.x, y: c.y }];
    }),
  );
  orderBranches(blocks, blockById, centers, edges, rootOf, byId, input);

  const placed: Record<string, [number, number]> = {};
  for (const b of blocks) {
    const center = centers.get(b.id) ?? { x: 0, y: 0 };
    b.place(center.x - b.width / 2, center.y - b.height / 2, placed);
  }

  // Âncora (FR-004): o canto superior esquerdo dos nós organizados não muda.
  const ids = Object.keys(placed);
  const minOf = (values: number[]) => Math.min(...values);
  const before = {
    x: minOf(ids.map((id) => byId.get(id)?.position[0] ?? 0)),
    y: minOf(ids.map((id) => byId.get(id)?.position[1] ?? 0)),
  };
  const after = {
    x: minOf(ids.map((id) => placed[id]?.[0] ?? 0)),
    y: minOf(ids.map((id) => placed[id]?.[1] ?? 0)),
  };
  return Object.fromEntries(
    ids.map((id) => {
      const [x, y] = placed[id] ?? [0, 0];
      return [id, [Math.round(x - after.x + before.x), Math.round(y - after.y + before.y)]];
    }),
  );
}

/**
 * O dagre não conhece a ordem das portas: os destinos de um nó com várias saídas (If, Switch)
 * podem sair invertidos e cruzar as arestas. Quando esses destinos estão na mesma coluna, são
 * vizinhos e só têm esse nó como origem, eles são reempilhados na ordem das saídas, no mesmo
 * espaço vertical (sem sobrepor os demais nós da coluna).
 */
function orderBranches(
  blocks: Block[],
  blockById: Map<string, Block>,
  centers: Map<string, { x: number; y: number }>,
  edges: Edge[],
  rootOf: Map<string, string>,
  byId: Map<string, WorkflowNode>,
  input: TidyUpInput,
): void {
  const mainEdges = edges.filter((e) => !input.isSubNodeEdge(e));
  const sourcesOf = (id: string) =>
    new Set(
      mainEdges
        .filter((e) => rootOf.get(e.to) === id && rootOf.get(e.from) !== id)
        .map((e) => rootOf.get(e.from)),
    );
  for (const source of blocks) {
    const node = byId.get(source.id);
    if (!node) continue;
    const order = input.outputOrder(node);
    const rank = new Map<string, number>();
    for (const e of mainEdges) {
      const target = rootOf.get(e.to);
      if (rootOf.get(e.from) !== source.id || !target || target === source.id) continue;
      const i = order.indexOf(e.fromPort);
      rank.set(target, Math.min(rank.get(target) ?? Infinity, i < 0 ? order.length : i));
    }
    const targets = [...rank.keys()];
    if (targets.length < 2) continue;
    const column = centers.get(targets[0] ?? '')?.x;
    if (
      targets.some((t) => centers.get(t)?.x !== column) ||
      targets.some((t) => sourcesOf(t).size !== 1)
    ) {
      continue;
    }
    // Vizinhos na coluna: nenhum outro bloco entre eles.
    const tops = targets.map((t) => (centers.get(t)?.y ?? 0) - (blockById.get(t)?.height ?? 0) / 2);
    const bottoms = targets.map(
      (t) => (centers.get(t)?.y ?? 0) + (blockById.get(t)?.height ?? 0) / 2,
    );
    const span = { top: Math.min(...tops), bottom: Math.max(...bottoms) };
    const intruder = blocks.some((b) => {
      const c = centers.get(b.id);
      if (!c || targets.includes(b.id)) return false;
      return c.x === column && c.y > span.top && c.y < span.bottom;
    });
    if (intruder) continue;
    const sorted = targets.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    const heights = sorted.map((t) => blockById.get(t)?.height ?? 0);
    const gap =
      (span.bottom - span.top - heights.reduce((s, h) => s + h, 0)) /
      Math.max(1, sorted.length - 1);
    let top = span.top;
    sorted.forEach((t, i) => {
      const h = heights[i] ?? 0;
      centers.set(t, { x: column ?? 0, y: top + h / 2 });
      top += h + gap;
    });
  }
}
