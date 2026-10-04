import type { WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import {
  copySelection,
  defaultParams,
  prepareClipboardPaste,
  removeElements,
  uniqueName,
} from './graph';

const node = (id: string, name: string, x = 0): WorkflowNode => ({
  id,
  type: 'data.set',
  name,
  params: {},
  position: [x, 0],
});

describe('spec 002 — FR-008: nomes únicos ao colar', () => {
  it('FR-008: mantém o nome livre e numera o repetido no estilo do N8N', () => {
    expect(uniqueName('Definir campos', [])).toBe('Definir campos');
    expect(uniqueName('Definir campos', ['Definir campos'])).toBe('Definir campos1');
    expect(uniqueName('Definir campos', ['Definir campos', 'Definir campos1'])).toBe(
      'Definir campos2',
    );
    expect(uniqueName('Definir campos1', ['Definir campos1'])).toBe('Definir campos2');
  });

  it('FR-008: colar gera ids e nomes novos, desloca a posição e remapeia as conexões internas', () => {
    const nodes = [node('a', 'A'), node('b', 'B', 100), node('c', 'C')];
    const edges = [
      { id: 'e1', from: 'a', fromPort: 'main', to: 'b', toPort: 'main' },
      { id: 'e2', from: 'b', fromPort: 'main', to: 'c', toPort: 'main' },
    ];
    const clipboard = copySelection(nodes, edges, ['a', 'b']);
    expect(clipboard.edges.map((e) => e.id)).toEqual(['e1']);

    let n = 0;
    const pasted = prepareClipboardPaste(clipboard, nodes, () => `novo${++n}`);
    expect(pasted.nodes.map((p) => [p.id, p.name, p.position])).toEqual([
      ['novo1', 'A1', [40, 40]],
      ['novo2', 'B1', [140, 40]],
    ]);
    expect(pasted.edges).toEqual([
      { id: 'novo3', from: 'novo1', fromPort: 'main', to: 'novo2', toPort: 'main' },
    ]);
  });

  it('FR-008: excluir nó remove as conexões dele', () => {
    const edges = [{ id: 'e', from: 'a', fromPort: 'main', to: 'b', toPort: 'main' }];
    expect(removeElements([node('a', 'A'), node('b', 'B')], edges, ['a'], [])).toEqual({
      nodes: [node('b', 'B')],
      edges: [],
    });
  });

  it('FR-009: parâmetros novos recebem os defaults do schema', () => {
    expect(
      defaultParams({
        type: 'object',
        properties: {
          fields: { type: 'array', default: [] },
          keep: { type: 'boolean', default: false },
          x: { type: 'string' },
        },
      }),
    ).toEqual({ fields: [], keep: false });
  });
});

describe('ícones do catálogo de nós', () => {
  it('todo nó da plataforma tem ícone próprio no editor', async () => {
    const { builtinNodes } = await import('@olly/nodes');
    const { KNOWN_ICONS } = await import('./node-icons');
    expect(builtinNodes.map((n) => n.icon).filter((icon) => !KNOWN_ICONS.includes(icon))).toEqual(
      [],
    );
  });
});
