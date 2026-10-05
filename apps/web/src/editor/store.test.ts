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
  publishedVersion: null,
  active: false,
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
      reused: false,
      dataTruncated: false,
      data: { input: { main: [] }, output: { main: [{ json: {} }, { json: {} }] } },
      error: null,
    });
    expect(store().run.nodes.n1).toMatchObject({ status: 'success', itemsOut: 2, durationMs: 5 });
    store().runFinished({ executionId: 'exec-1', status: 'success', finishedAt: '', error: null });
    expect(store().run.status).toBe('success');
  });

  it('FR-020: executar um nó mantém os dados de quem não depende dele e descarta os posteriores', () => {
    const [m, a, b, c] = ['m', 'a', 'b', 'c'].map((n, i) => store().addNode(setType, [i * 100, 0]));
    for (const [from, to] of [
      [m, a],
      [a, b],
      [m, c],
    ] as const)
      store().connect({ from: from ?? '', fromPort: 'main', to: to ?? '', toPort: 'main' });
    const finish = (executionId: string, nodeId: string, reused = false) => {
      store().nodeFinished({
        executionId,
        nodeId,
        status: 'success',
        itemsIn: 1,
        itemsOut: 1,
        durationMs: 1,
        pinned: false,
        reused,
        dataTruncated: false,
        data: { input: {}, output: { main: [{ json: { de: executionId } }] } },
        error: null,
      });
    };
    store().runStarted('exec-1', { signatures: { [m ?? '']: 'sig-m', [a ?? '']: 'sig-a' } });
    for (const id of [m, a, b, c]) finish('exec-1', id ?? '');
    expect(store().run.nodes[a ?? '']).toMatchObject({ executionId: 'exec-1', signature: 'sig-a' });

    store().runStarted('exec-2', { destinationNodeId: a ?? '' });
    expect(Object.keys(store().run.nodes).sort()).toEqual([m, c].sort());
    expect(store().run.status).toBe('running');
    finish('exec-2', m ?? '', true);
    finish('exec-2', a ?? '');
    expect(store().run.nodes[m ?? '']).toMatchObject({ reused: true, executionId: 'exec-2' });
    // c não depende de a: continua com os dados da execução 1.
    expect(store().run.nodes[c ?? '']?.executionId).toBe('exec-1');

    store().runStarted('exec-3');
    expect(store().run.nodes).toEqual({});
  });
});

describe('spec 002 — FR-007: excluir conexão', () => {
  it('FR-007: remove só a conexão indicada, entra no histórico e limpa a seleção', () => {
    const a = store().addNode(setType, [0, 0]);
    const b = store().addNode(setType, [100, 0]);
    store().connect({ from: a, fromPort: 'main', to: b, toPort: 'main' });
    const edgeId = store().edges[0]?.id ?? '';
    store().setSelection({ nodeIds: [], edgeIds: [edgeId] });
    store().removeEdge(edgeId);
    expect(store().edges).toEqual([]);
    expect(store().nodes).toHaveLength(2);
    expect(store().selection.edgeIds).toEqual([]);
    store().undo();
    expect(store().edges).toHaveLength(1);
    store().removeEdge('inexistente');
    expect(store().edges).toHaveLength(1);
  });
});

describe('spec 004 — FR-007/FR-017: credencial e configurações do nó', () => {
  it('FR-007: associa e remove a credencial do nó; a definição só leva o campo quando há valor', () => {
    const id = store().addNode(setType, [0, 0]);
    store().updateNode(id, { credentialId: 'cred-1' });
    expect(store().definition().nodes[0]?.credentialId).toBe('cred-1');
    store().updateNode(id, { credentialId: undefined });
    expect(store().definition().nodes[0]).not.toHaveProperty('credentialId');
    store().undo();
    expect(store().nodes[0]?.credentialId).toBe('cred-1');
  });

  it('FR-017: grava retry, timeout e onError no nó e remove quando vazio', () => {
    const id = store().addNode(setType, [0, 0]);
    store().updateNode(id, {
      settings: {
        retry: { maxTries: 3, waitMs: 1000, backoff: 'exponential' },
        onError: 'continue',
      },
    });
    expect(store().definition().nodes[0]?.settings).toEqual({
      retry: { maxTries: 3, waitMs: 1000, backoff: 'exponential' },
      onError: 'continue',
    });
    store().updateNode(id, { settings: undefined });
    expect(store().definition().nodes[0]).not.toHaveProperty('settings');
  });
});

describe('spec 005 — FR-012/FR-014: console e dados omitidos na execução', () => {
  it('FR-012/FR-014: o evento leva o console; sem readData, o nó fica marcado como sem dados', () => {
    store().runStarted('exec-c');
    store().nodeFinished({
      executionId: 'exec-c',
      nodeId: 'code',
      status: 'success',
      itemsIn: 1,
      itemsOut: 1,
      durationMs: 3,
      pinned: false,
      reused: false,
      dataTruncated: false,
      data: { input: {}, output: {} },
      console: ['olá'],
      error: null,
    });
    expect(store().run.nodes.code?.console).toEqual(['olá']);
    store().nodeFinished({
      executionId: 'exec-c',
      nodeId: 'outro',
      status: 'success',
      itemsIn: 1,
      itemsOut: 1,
      durationMs: 3,
      pinned: false,
      reused: false,
      dataTruncated: false,
      dataRedacted: true,
      data: { input: {}, output: {} },
      error: null,
    });
    expect(store().run.nodes.outro?.dataRedacted).toBe(true);
  });

  it('FR-007: estado da escuta do webhook de teste', () => {
    store().setWebhookListening('2026-10-04T12:00:00.000Z');
    expect(store().webhookListening).toBe('2026-10-04T12:00:00.000Z');
    store().reset();
    expect(store().webhookListening).toBeNull();
  });
});
