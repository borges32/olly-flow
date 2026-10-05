import type { NodeDescription } from '@olly/nodes';
import type { WorkflowDetail } from '@olly/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateNodeGuarded } from './port-guard';
import { useEditorStore } from './store';

const merge = {
  type: 'logic.merge',
  inputs: [],
  outputs: [{ name: 'main', kind: 'main' }],
  dynamicPorts: { kind: 'mergeInputs' },
} as unknown as NodeDescription;

const workflow: WorkflowDetail = {
  id: 'w',
  projectId: 'p',
  name: 'Fluxo',
  version: 1,
  createdAt: '',
  updatedAt: '',
  createdBy: null,
  warnings: [],
  definition: {
    nodes: [
      { id: 'a', type: 'data.set', name: 'A', params: {}, position: [0, 0] },
      {
        id: 'mg',
        type: 'logic.merge',
        name: 'Junta',
        params: { numberInputs: 3 },
        position: [0, 0],
      },
    ],
    edges: [
      { id: 'e1', from: 'a', fromPort: 'main', to: 'mg', toPort: 'input1' },
      { id: 'e3', from: 'a', fromPort: 'main', to: 'mg', toPort: 'input3' },
    ],
    settings: {},
  },
  publishedVersion: null,
  active: false,
};

beforeEach(() => {
  useEditorStore.getState().load(workflow);
});

describe('spec 007 — FR-001: portas dinâmicas no editor', () => {
  it('FR-001: reduzir as entradas do Merge pede confirmação e remove as conexões órfãs', () => {
    const confirm = vi.fn(() => true);
    expect(
      updateNodeGuarded(merge, 'mg', { params: { numberInputs: 2 } }, undefined, confirm),
    ).toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 conexão'));
    expect(useEditorStore.getState().edges.map((e) => e.id)).toEqual(['e1']);
    // Desfazer devolve a conexão.
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().edges.map((e) => e.id)).toEqual(['e1', 'e3']);
  });

  it('FR-001: desistir mantém o nó e as conexões', () => {
    expect(
      updateNodeGuarded(merge, 'mg', { params: { numberInputs: 2 } }, undefined, () => false),
    ).toBe(false);
    const state = useEditorStore.getState();
    expect(state.nodes.find((n) => n.id === 'mg')?.params.numberInputs).toBe(3);
    expect(state.edges).toHaveLength(2);
  });

  it('FR-001: aumentar as entradas não pergunta nada', () => {
    const confirm = vi.fn(() => true);
    updateNodeGuarded(merge, 'mg', { params: { numberInputs: 4 } }, undefined, confirm);
    expect(confirm).not.toHaveBeenCalled();
  });
});
