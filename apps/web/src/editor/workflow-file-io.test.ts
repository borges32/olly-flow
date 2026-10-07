import type { NodeDescription } from '@olly/nodes';
import type { WorkflowDetail, WorkflowNode } from '@olly/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './store';
import {
  catalogFrom,
  looksLikeWorkflowJson,
  parsePastedFile,
  selectionAsFileText,
} from './workflow-file-io';

const type = (t: string, extra: Partial<NodeDescription> = {}): NodeDescription => ({
  type: t,
  version: 1,
  displayName: t,
  description: '',
  icon: 'play',
  category: 'data',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: { type: 'object', properties: {} },
  ...extra,
});
const types = new Map(
  [
    type('trigger.manual', { inputs: [] }),
    type('http.request', {
      credentialTypes: ['httpBearer'],
      paramsSchema: { type: 'object', properties: { method: { type: 'string', default: 'GET' } } },
    }),
    type('placeholder.unsupported', {
      inputs: [{ name: 'in0', kind: 'main' }],
      outputs: [{ name: 'out0', kind: 'main' }],
      dynamicPorts: { kind: 'placeholder' },
    }),
  ].map((t) => [t.type, t]),
);
const catalog = catalogFrom(types);
const credentials = [{ id: 'c1', type: 'httpBearer', name: 'API' }];
let seq = 0;
const newId = () => `id-${String(++seq)}`;

const nodes: WorkflowNode[] = [
  { id: 'a', name: 'Início', type: 'trigger.manual', params: {}, position: [0, 0] },
  {
    id: 'b',
    name: 'Buscar',
    type: 'http.request',
    params: { method: 'GET' },
    position: [260, 0],
    credentialId: 'c1',
  },
  { id: 'c', name: 'Outro', type: 'trigger.manual', params: {}, position: [0, 200] },
];
const edges = [{ id: 'e', from: 'a', fromPort: 'main', to: 'b', toPort: 'main' }];

describe('spec 015 — FR-019: copiar nós como JSON no formato do arquivo', () => {
  it('só os selecionados e as conexões entre eles, com a credencial referenciada pelo nome', () => {
    const text = selectionAsFileText({ nodes, edges }, ['a', 'b'], catalog, credentials);
    const file = JSON.parse(text ?? '{}') as Record<string, unknown>;
    expect(Object.keys(file).sort()).toEqual(['connections', 'meta', 'nodes', 'pinData']);
    expect(file.connections).toEqual({
      Início: { main: [[{ node: 'Buscar', type: 'main', index: 0 }]] },
    });
    expect((file.nodes as { name: string; credentials?: unknown }[]).map((n) => n.name)).toEqual([
      'Início',
      'Buscar',
    ]);
    expect((file.nodes as { credentials?: unknown }[])[1]?.credentials).toEqual({
      httpBearer: { id: 'c1', name: 'API' },
    });
    expect(selectionAsFileText({ nodes, edges }, [], catalog, credentials)).toBeNull();
  });
});

describe('spec 015 — FR-020/SC-006: colar JSON no canvas', () => {
  beforeEach(() => {
    useEditorStore.getState().load({
      id: 'w',
      projectId: 'p',
      name: 'Fluxo',
      version: 1,
      createdAt: '',
      updatedAt: '',
      createdBy: null,
      warnings: [],
      definition: { nodes: structuredClone(nodes), edges: structuredClone(edges), settings: {} },
      publishedVersion: null,
      active: false,
    } satisfies WorkflowDetail);
  });

  it('copiar e colar (passando por texto) acrescenta os nós com nomes únicos e as conexões', () => {
    const text = selectionAsFileText({ nodes, edges }, ['a', 'b'], catalog, credentials) ?? '';
    expect(looksLikeWorkflowJson(text)).toBe(true);
    const parsed = parsePastedFile(text, catalog, credentials, newId);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pending).toEqual([]);
    useEditorStore.getState().pasteNodes(parsed.clipboard);
    const state = useEditorStore.getState();
    expect(state.nodes.map((n) => n.name)).toEqual([
      'Início',
      'Buscar',
      'Outro',
      'Início1',
      'Buscar1',
    ]);
    const pasted = state.nodes.slice(3);
    expect(pasted[1]).toMatchObject({ params: { method: 'GET' }, credentialId: 'c1' });
    expect(state.edges.at(-1)).toMatchObject({
      from: pasted[0]?.id,
      to: pasted[1]?.id,
      fromPort: 'main',
    });
    expect(state.selection.nodeIds).toEqual(pasted.map((n) => n.id));
    expect(state.dirty).toBe(true);
  });

  it('JSON gerado fora (sem ids nem posições, tipo desconhecido, credencial de outro lugar)', () => {
    const parsed = parsePastedFile(
      JSON.stringify({
        nodes: [
          { name: 'Chamar', type: 'http.request', credentials: { httpBearer: { name: 'Outra' } } },
          { name: 'Planilha', type: 'outra.planilha' },
        ],
        connections: { Chamar: { main: [[{ node: 'Planilha', type: 'main', index: 0 }]] } },
      }),
      catalog,
      credentials,
      newId,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.clipboard.nodes[0]).toMatchObject({
      params: { method: 'GET' },
      position: [0, 0],
    });
    expect(parsed.clipboard.nodes[0]?.credentialId).toBeUndefined();
    expect(parsed.clipboard.nodes[1]).toMatchObject({
      type: 'placeholder.unsupported',
      disabled: true,
    });
    expect(parsed.pending.map((p) => p.code).sort()).toEqual([
      'CREDENTIAL_PENDING',
      'UNSUPPORTED_NODE',
    ]);
  });

  it('texto inválido não altera o canvas: devolve os erros', () => {
    expect(parsePastedFile('{"nodes": [', catalog, credentials, newId)).toMatchObject({
      ok: false,
      errors: [{ code: 'IMPORT_INVALID_JSON' }],
    });
    expect(
      parsePastedFile(
        '{"nodes":[{"name":"A","type":"trigger.manual"}],"connections":{"A":{"main":[[{"node":"X","type":"main","index":0}]]}}}',
        catalog,
        credentials,
        newId,
      ),
    ).toMatchObject({ ok: false, errors: [{ code: 'CONNECTION_UNKNOWN_NODE' }] });
    expect(looksLikeWorkflowJson('texto comum')).toBe(false);
  });
});
