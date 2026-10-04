import type { NodeDescription } from '@olly/nodes';
import type { WorkflowDetail } from '@olly/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './store';

const setType: NodeDescription = {
  type: 'data.set',
  version: 1,
  displayName: 'Definir campos',
  description: '',
  icon: 'pen-line',
  category: 'data',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: { type: 'object', properties: { fields: { type: 'array', default: [] } } },
};

const workflow: WorkflowDetail = {
  id: 'w',
  projectId: 'p',
  name: 'Fluxo',
  version: 3,
  createdAt: '',
  updatedAt: '',
  createdBy: null,
  warnings: [],
  definition: { nodes: [], edges: [], settings: {} },
};

const store = () => useEditorStore.getState();

beforeEach(() => {
  store().load(workflow);
});

describe('spec 002 — FR-008: desfazer/refazer, copiar/colar e indicador de não salvo', () => {
  it('FR-008: adicionar marca alterações não salvas; salvar limpa', () => {
    expect(store().dirty).toBe(false);
    store().addNode(setType, [0, 0]);
    expect(store().dirty).toBe(true);
    store().markSaved({ ...workflow, version: 4 });
    expect(store()).toMatchObject({ dirty: false, baseVersion: 4 });
  });

  it('FR-008: desfaz e refaz a adição de nós', () => {
    store().addNode(setType, [0, 0]);
    store().addNode(setType, [0, 100]);
    expect(store().nodes.map((n) => n.name)).toEqual(['Definir campos', 'Definir campos1']);
    store().undo();
    expect(store().nodes).toHaveLength(1);
    store().redo();
    expect(store().nodes).toHaveLength(2);
  });

  it('FR-008: nova mudança descarta o refazer', () => {
    store().addNode(setType, [0, 0]);
    store().undo();
    store().addNode(setType, [10, 10]);
    expect(store().future).toEqual([]);
  });

  it('FR-008: edições seguidas no mesmo campo viram um único passo de desfazer', () => {
    const id = store().addNode(setType, [0, 0]);
    for (const name of ['A', 'Ab', 'Abc']) store().updateNode(id, { name }, `${id}:name`);
    expect(store().nodes[0]?.name).toBe('Abc');
    store().undo();
    expect(store().nodes[0]?.name).toBe('Definir campos');
  });

  it('FR-008: copiar e colar com nomes únicos; excluir a seleção; desfazer a exclusão', () => {
    const a = store().addNode(setType, [0, 0]);
    store().setSelection({ nodeIds: [a], edgeIds: [] });
    store().copy();
    store().paste();
    store().paste();
    expect(store().nodes.map((n) => n.name)).toEqual([
      'Definir campos',
      'Definir campos1',
      'Definir campos2',
    ]);
    expect(store().nodes[2]?.position).toEqual([80, 80]);
    store().removeSelection();
    expect(store().nodes).toHaveLength(2);
    store().undo();
    expect(store().nodes).toHaveLength(3);
  });

  it('FR-008: o histórico guarda no máximo 100 passos', () => {
    for (let i = 0; i < 120; i++) store().addNode(setType, [i, 0]);
    expect(store().past).toHaveLength(100);
  });

  it('FR-007: conectar ignora conexões repetidas', () => {
    const a = store().addNode(setType, [0, 0]);
    const b = store().addNode(setType, [100, 0]);
    store().connect({ from: a, fromPort: 'main', to: b, toPort: 'main' });
    store().connect({ from: a, fromPort: 'main', to: b, toPort: 'main' });
    expect(store().edges).toHaveLength(1);
  });

  it('FR-007: mover após checkpoint é desfeito em um passo', () => {
    const a = store().addNode(setType, [0, 0]);
    store().checkpoint();
    store().moveNodes({ [a]: [10, 10] });
    store().moveNodes({ [a]: [50, 50] });
    store().undo();
    expect(store().nodes[0]?.position).toEqual([0, 0]);
  });
});

describe('spec 003 — FR-016/FR-012: pin data e estado da execução no editor', () => {
  it('FR-016: fixar e desafixar dados entra no histórico e na definição salva', () => {
    const id = store().addNode(setType, [0, 0]);
    store().setPinData(id, [{ json: { a: 1 } }]);
    expect(store().definition().pinData).toEqual({ [id]: [{ json: { a: 1 } }] });
    store().undo();
    expect(store().definition()).not.toHaveProperty('pinData');
    store().redo();
    store().setPinData(id, null);
    expect(store().pinData).toEqual({});
  });

  it('FR-016: excluir o nó remove os dados fixados dele', () => {
    const id = store().addNode(setType, [0, 0]);
    store().setPinData(id, [{ json: {} }]);
    store().setSelection({ nodeIds: [id], edgeIds: [] });
    store().removeSelection();
    expect(store().pinData).toEqual({});
  });

  it('FR-012: eventos atualizam o status por nó só da execução corrente', () => {
    store().runStarted('exec-1');
    store().nodeStarted('exec-1', 'n1');
    expect(store().run.nodes.n1?.status).toBe('running');
    store().nodeStarted('outra', 'n2');
    expect(store().run.nodes).not.toHaveProperty('n2');
    store().nodeFinished({
      executionId: 'exec-1',
      nodeId: 'n1',
      status: 'success',
      itemsIn: 1,
      itemsOut: 2,
      durationMs: 5,
      pinned: false,
      dataTruncated: false,
      data: { input: { main: [] }, output: { main: [{ json: {} }, { json: {} }] } },
      error: null,
    });
    expect(store().run.nodes.n1).toMatchObject({ status: 'success', itemsOut: 2, durationMs: 5 });
    store().runFinished({ executionId: 'exec-1', status: 'success', finishedAt: '', error: null });
    expect(store().run.status).toBe('success');
  });
});
