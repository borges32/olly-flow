import type { Edge, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NODE_SIZE, tidyUp, type TidyUpInput } from './tidy-up';

const SUB_TYPES = ['ai.chatModel', 'memory.postgres', 'tool.code', 'outputParser.structured'];
const ROOT_INPUTS = ['main', 'ai_languageModel', 'ai_memory', 'ai_tool', 'ai_outputParser'];

let x = 0;
const node = (id: string, type = 'data.set'): WorkflowNode => ({
  id,
  type,
  name: id,
  params: {},
  // Posições bagunçadas e sobrepostas, como num workflow importado.
  position: [(x += 7) % 50, (x * 13) % 40],
});
const main = (from: string, to: string, fromPort = 'main', toPort = 'main'): Edge => ({
  id: `${from}-${to}-${fromPort}-${toPort}`,
  from,
  fromPort,
  to,
  toPort,
});
const sub = (from: string, to: string, kind: string): Edge => main(from, to, kind, kind);

const run = (nodes: WorkflowNode[], edges: Edge[], extra: Partial<TidyUpInput> = {}) =>
  tidyUp({
    nodes,
    edges,
    sizes: {},
    isSubNode: (n) => SUB_TYPES.includes(n.type),
    isSubNodeEdge: (e) => e.toPort.startsWith('ai_'),
    inputOrder: () => ROOT_INPUTS,
    outputOrder: (n) => (n.type === 'logic.if' ? ['true', 'false'] : ['main']),
    selection: [],
    ...extra,
  });

const { width: W, height: H } = DEFAULT_NODE_SIZE;
const overlaps = (positions: Record<string, [number, number]>) => {
  const ids = Object.keys(positions);
  for (const a of ids)
    for (const b of ids) {
      if (a >= b) continue;
      const [ax, ay] = positions[a] as [number, number];
      const [bx, by] = positions[b] as [number, number];
      if (ax < bx + W && bx < ax + W && ay < by + H && by < ay + H) return [a, b];
    }
  return null;
};

describe('spec 023 — organizar os nós', () => {
  it('SC-001/FR-001: da esquerda para a direita na ordem das conexões, ramos do If empilhados, sem sobreposição', () => {
    const nodes = ['inicio', 'se', 'sim', 'nao', 'junta', 'fim'].map((id) =>
      node(id, id === 'inicio' ? 'trigger.manual' : id === 'se' ? 'logic.if' : 'data.set'),
    );
    const edges = [
      main('inicio', 'se'),
      main('se', 'sim', 'true'),
      main('se', 'nao', 'false'),
      main('sim', 'junta', 'main', 'input1'),
      main('nao', 'junta', 'main', 'input2'),
      main('junta', 'fim'),
    ];
    const p = run(nodes, edges);
    expect(Object.keys(p).sort()).toEqual(nodes.map((n) => n.id).sort());
    expect(overlaps(p)).toBeNull();
    for (const e of edges) expect(p[e.from]?.[0]).toBeLessThan(p[e.to]?.[0] ?? 0);
    // Os dois ramos ficam na mesma coluna, na ordem das saídas do If (verdadeiro em cima).
    expect(p.sim?.[0]).toBe(p.nao?.[0]);
    expect(p.sim?.[1]).toBeLessThan(p.nao?.[1] ?? 0);
    // Com as saídas na ordem contrária no workflow, o resultado é o mesmo.
    const swapped = run(nodes, [edges[0], edges[2], edges[1], ...edges.slice(3)] as Edge[]);
    expect(swapped.sim?.[1]).toBeLessThan(swapped.nao?.[1] ?? 0);
  });

  it('FR-002: sub-nós embaixo do pai, lado a lado, na ordem das entradas; sub-nó de sub-nó embaixo dele', () => {
    const nodes = [
      node('inicio', 'trigger.manual'),
      node('agente', 'ai.agent'),
      node('parser', 'outputParser.structured'),
      node('modelo', 'ai.chatModel'),
      node('memoria', 'memory.postgres'),
      node('ferramenta', 'tool.code'),
      node('modelo-do-parser', 'ai.chatModel'),
      node('depois'),
    ];
    const edges = [
      main('inicio', 'agente'),
      main('agente', 'depois'),
      sub('parser', 'agente', 'ai_outputParser'),
      sub('modelo', 'agente', 'ai_languageModel'),
      sub('memoria', 'agente', 'ai_memory'),
      sub('ferramenta', 'agente', 'ai_tool'),
      sub('modelo-do-parser', 'parser', 'ai_languageModel'),
    ];
    const p = run(nodes, edges);
    expect(overlaps(p)).toBeNull();
    const agent = p.agente as [number, number];
    const row = ['modelo', 'memoria', 'ferramenta', 'parser'].map(
      (id) => p[id] as [number, number],
    );
    // Mesma linha, embaixo do Agent, na ordem das entradas (modelo, memória, ferramenta, parser).
    for (const pos of row) expect(pos[1]).toBe(row[0]?.[1]);
    expect(row[0]?.[1]).toBeGreaterThan(agent[1] + H);
    expect(row.map((pos) => pos[0])).toEqual([...row.map((pos) => pos[0])].sort((a, b) => a - b));
    // A fileira fica centralizada embaixo do Agent.
    const center = ((row[0]?.[0] ?? 0) + (row[3]?.[0] ?? 0) + W) / 2;
    expect(Math.abs(center - (agent[0] + W / 2))).toBeLessThanOrEqual(1);
    // O modelo do parser fica embaixo do parser.
    expect(p['modelo-do-parser']?.[1]).toBeGreaterThan((p.parser?.[1] ?? 0) + H);
    expect(p['modelo-do-parser']?.[0]).toBe(p.parser?.[0]);
    // O Agent fica na linha do fluxo (sub-nós pendurados embaixo), alinhado com os vizinhos.
    expect(agent[1]).toBe(p.inicio?.[1]);
    expect(agent[1]).toBe(p.depois?.[1]);
    // O fluxo principal segue da esquerda para a direita.
    expect(p.inicio?.[0]).toBeLessThan(agent[0]);
    expect(agent[0]).toBeLessThan(p.depois?.[0] ?? 0);
  });

  it('FR-003: com 2+ nós selecionados, só eles (e os sub-nós deles) mudam; com 1, tudo', () => {
    const nodes = [
      node('a'),
      node('b'),
      node('c'),
      node('d', 'ai.agent'),
      node('m', 'ai.chatModel'),
    ];
    const edges = [
      main('a', 'b'),
      main('b', 'c'),
      main('c', 'd'),
      sub('m', 'd', 'ai_languageModel'),
    ];
    const part = run(nodes, edges, { selection: ['c', 'd'] });
    expect(Object.keys(part).sort()).toEqual(['c', 'd', 'm']);
    const all = run(nodes, edges, { selection: ['c'] });
    expect(Object.keys(all).sort()).toEqual(['a', 'b', 'c', 'd', 'm']);
  });

  it('FR-004: canto superior esquerdo mantido; laço e partes desconectadas terminam sem sobreposição; tamanho real', () => {
    const nodes = [
      node('inicio', 'trigger.manual'),
      node('laco', 'logic.loopOverItems'),
      node('corpo'),
      node('solto'),
      node('outro-inicio', 'trigger.manual'),
      node('outro-fim'),
    ];
    nodes[0] = { ...nodes[0], position: [300, 200] } as WorkflowNode;
    const edges = [
      main('inicio', 'laco'),
      main('laco', 'corpo', 'loop'),
      main('corpo', 'laco', 'main', 'continue'),
      main('outro-inicio', 'outro-fim'),
    ];
    const p = run(nodes, edges, { sizes: { corpo: { width: 400, height: 200 } } });
    const xs = Object.values(p).map(([px]) => px);
    const ys = Object.values(p).map(([, py]) => py);
    const before = nodes.map((n) => n.position);
    expect(Math.min(...xs)).toBe(Math.min(...before.map(([bx]) => bx)));
    expect(Math.min(...ys)).toBe(Math.min(...before.map(([, by]) => by)));
    // O corpo (400 × 200) não encosta em nenhum outro nó.
    const [cx, cy] = p.corpo as [number, number];
    for (const [id, [px, py]] of Object.entries(p)) {
      if (id === 'corpo') continue;
      expect(px < cx + 400 && cx < px + W && py < cy + 200 && cy < py + H, id).toBe(false);
    }
    expect(
      overlaps(Object.fromEntries(Object.entries(p).filter(([id]) => id !== 'corpo'))),
    ).toBeNull();
  });

  it('NFR-001: 100 nós em menos de 1 s; workflow vazio não muda nada', () => {
    const nodes = Array.from({ length: 100 }, (_, i) => node(`n${String(i)}`));
    const edges = nodes.slice(1).map((n, i) => main(`n${String(Math.floor(i / 3))}`, n.id));
    const started = performance.now();
    const p = run(nodes, edges);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(Object.keys(p)).toHaveLength(100);
    expect(overlaps(p)).toBeNull();
    expect(run([], [])).toEqual({});
  });
});
