import { describe, expect, it } from 'vitest';
import type { NodeTypeCatalog, NodeTypeInfo } from './workflow-file.js';
import {
  checkUntrusted,
  fromWorkflowFile,
  resolveCredentialRef,
  toWorkflowFile,
  WORKFLOW_FILE_FORMAT_VERSION,
} from './workflow-file.js';
import type { WorkflowDefinition } from './workflow.js';

const main = (name = 'main') => ({ name, kind: 'main' as const });
const TYPES: Record<string, NodeTypeInfo> = {
  'trigger.manual': { version: 1, inputs: [], outputs: [main()] },
  'data.set': {
    version: 1,
    inputs: [main()],
    outputs: [main()],
    paramsSchema: {
      properties: {
        fields: { type: 'array', default: [] },
        includeOtherFields: { type: 'boolean', default: false },
        keepOnlySet: { type: 'boolean', 'x-hidden': true },
      },
    },
  },
  'logic.if': { version: 1, inputs: [main()], outputs: [main('true'), main('false')] },
  'logic.merge': {
    version: 1,
    inputs: [main('input1'), main('input2')],
    outputs: [main()],
    dynamicPorts: { kind: 'mergeInputs' },
  },
  'logic.loopOverItems': {
    version: 1,
    inputs: [main(), main('continue')],
    outputs: [main('done'), main('loop')],
  },
  'http.request': {
    version: 1,
    inputs: [main()],
    outputs: [main()],
    credentialTypes: ['httpBearer', 'httpBasic'],
    paramsSchema: { properties: { method: { default: 'GET' }, url: { default: '' } } },
  },
  'ai.agent': {
    version: 1,
    inputs: [
      main(),
      { name: 'ai_languageModel', kind: 'ai_languageModel' },
      { name: 'ai_tool', kind: 'ai_tool' },
    ],
    outputs: [main()],
  },
  'ai.chatModel': {
    version: 1,
    inputs: [],
    outputs: [{ name: 'ai_languageModel', kind: 'ai_languageModel' }],
  },
  'placeholder.unsupported': {
    version: 1,
    inputs: [main('in0')],
    outputs: [main('out0')],
    dynamicPorts: { kind: 'placeholder' },
  },
};
const catalog: NodeTypeCatalog = { get: (t) => TYPES[t] };
let seq = 0;
const newId = () => `gen-${String(++seq)}`;
const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type,
  params: {},
  position: [0, 0] as [number, number],
  ...extra,
});

const definition: WorkflowDefinition = {
  nodes: [
    node('Início', 'trigger.manual'),
    node('Buscar', 'http.request', {
      params: { method: 'GET', url: '={{ $json.url }}' },
      credentialId: 'cred-1',
      settings: {
        onError: 'errorOutput',
        retry: { maxTries: 4, waitMs: 500, backoff: 'exponential' },
        timeoutMs: 9000,
        parallelItems: { enabled: true, concurrency: 3 },
      },
    }),
    node('Se', 'logic.if'),
    node('Juntar', 'logic.merge', { params: { numberInputs: 2 } }),
    node('Loop', 'logic.loopOverItems'),
    node('Corpo', 'data.set', { params: { fields: [], includeOtherFields: true } }),
    node('Falha', 'data.set', { params: { fields: [], includeOtherFields: true }, disabled: true }),
    node('Agente', 'ai.agent'),
    node('Modelo', 'ai.chatModel'),
  ],
  edges: [
    { id: 'e1', from: 'Início', fromPort: 'main', to: 'Buscar', toPort: 'main' },
    { id: 'e2', from: 'Buscar', fromPort: 'main', to: 'Se', toPort: 'main' },
    { id: 'e3', from: 'Buscar', fromPort: 'error', to: 'Falha', toPort: 'main' },
    { id: 'e4', from: 'Se', fromPort: 'true', to: 'Juntar', toPort: 'input1' },
    { id: 'e5', from: 'Se', fromPort: 'false', to: 'Juntar', toPort: 'input2' },
    { id: 'e6', from: 'Juntar', fromPort: 'main', to: 'Loop', toPort: 'main' },
    { id: 'e7', from: 'Loop', fromPort: 'loop', to: 'Corpo', toPort: 'main' },
    { id: 'e8', from: 'Corpo', fromPort: 'main', to: 'Loop', toPort: 'continue' },
    { id: 'e9', from: 'Loop', fromPort: 'done', to: 'Agente', toPort: 'main' },
    {
      id: 'e10',
      from: 'Modelo',
      fromPort: 'ai_languageModel',
      to: 'Agente',
      toPort: 'ai_languageModel',
    },
  ],
  settings: {
    timeoutSec: 120,
    saveExecutionData: 'errorsOnly',
    maxParallel: 4,
    errorWorkflowId: 'wf-err',
  },
  pinData: { Início: [{ json: { url: 'https://api.exemplo.gov.br' } }] },
};
const credentialOf = (id: string) =>
  id === 'cred-1' ? { type: 'httpBearer', name: 'API de pedidos' } : undefined;

/** Sem os ids gerados (das arestas), para comparar a ida e a volta. */
const normalize = (def: WorkflowDefinition) => ({
  ...def,
  edges: def.edges
    .map(({ id: _id, ...e }) => e)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
});

describe('spec 015 — formato do arquivo (exportação)', () => {
  const file = toWorkflowFile(definition, {
    catalog,
    name: 'Pedidos',
    credentialOf,
    workflowVersion: 3,
  });

  it('FR-001/FR-002: envelope e nós no formato do N8N, com os tipos e parâmetros do Olly Flow', () => {
    expect(Object.keys(file).sort()).toEqual(
      ['active', 'connections', 'meta', 'name', 'nodes', 'pinData', 'settings', 'tags'].sort(),
    );
    expect(file).toMatchObject({ name: 'Pedidos', tags: [], active: false });
    expect(file.nodes[1]).toMatchObject({
      id: 'Buscar',
      name: 'Buscar',
      type: 'http.request',
      typeVersion: 1,
      position: [0, 0],
      parameters: { method: 'GET', url: '={{ $json.url }}' },
    });
  });

  it('FR-003: conexões pelo nome, com os índices das portas (If, Merge, laço, erro, sub-nó)', () => {
    const c = file.connections;
    expect(c.Buscar?.main).toEqual([
      [{ node: 'Se', type: 'main', index: 0 }],
      [{ node: 'Falha', type: 'main', index: 0 }],
    ]);
    expect(c.Se?.main).toEqual([
      [{ node: 'Juntar', type: 'main', index: 0 }],
      [{ node: 'Juntar', type: 'main', index: 1 }],
    ]);
    expect(c.Loop?.main).toEqual([
      [{ node: 'Agente', type: 'main', index: 0 }],
      [{ node: 'Corpo', type: 'main', index: 0 }],
    ]);
    expect(c.Corpo?.main).toEqual([[{ node: 'Loop', type: 'main', index: 1 }]]);
    expect(c.Modelo).toEqual({
      ai_languageModel: [[{ node: 'Agente', type: 'ai_languageModel', index: 0 }]],
    });
  });

  it('FR-004: configurações do nó e do workflow (campos do N8N + objeto ollyFlow)', () => {
    expect(file.nodes[1]).toMatchObject({
      onError: 'continueErrorOutput',
      retryOnFail: true,
      maxTries: 4,
      waitBetweenTries: 500,
      ollyFlow: {
        retryBackoff: 'exponential',
        timeoutMs: 9000,
        parallelItems: { enabled: true, concurrency: 3 },
      },
    });
    expect(file.nodes[6]).toMatchObject({ disabled: true });
    expect(file.settings).toEqual({
      executionTimeout: 120,
      errorWorkflow: 'wf-err',
      saveDataSuccessExecution: 'none',
      saveDataErrorExecution: 'all',
      ollyFlow: { maxParallel: 4 },
    });
  });

  it('FR-005: versão do formato nos metadados', () => {
    expect(file.meta).toEqual({
      ollyFlow: { formatVersion: WORKFLOW_FILE_FORMAT_VERSION, workflowVersion: 3 },
    });
  });

  it('FR-007: das credenciais, só tipo, id e nome', () => {
    expect(file.nodes[1]?.credentials).toEqual({
      httpBearer: { id: 'cred-1', name: 'API de pedidos' },
    });
    expect(JSON.stringify(file)).not.toContain('credentialId');
  });

  it('FR-009: os dados fixados vão no arquivo, pelo nome do nó', () => {
    expect(file.pinData).toEqual({ Início: [{ json: { url: 'https://api.exemplo.gov.br' } }] });
  });

  it('FR-019: cópia de nós (fragmento) sem nome nem configurações', () => {
    const fragment = toWorkflowFile(
      { nodes: definition.nodes.slice(0, 2), edges: [definition.edges[0] as never], settings: {} },
      { catalog, fragment: true },
    );
    expect(Object.keys(fragment).sort()).toEqual(['connections', 'meta', 'nodes', 'pinData']);
    expect(fragment.connections.Início?.main).toEqual([
      [{ node: 'Buscar', type: 'main', index: 0 }],
    ]);
  });
});

describe('spec 015 — importação do arquivo', () => {
  it('NFR-001/SC-001: ida e volta sem perda (a menos dos ids das arestas)', () => {
    const file = toWorkflowFile(definition, { catalog, name: 'Pedidos', credentialOf });
    const back = fromWorkflowFile(JSON.parse(JSON.stringify(file)), { catalog, newId });
    expect(back.issues).toEqual({ errors: [], pending: [], warnings: [] });
    expect(back.name).toBe('Pedidos');
    const withoutCredentials = {
      ...definition,
      nodes: definition.nodes.map(({ credentialId: _c, ...n }) => n),
    };
    expect(normalize(back.definition)).toEqual(normalize(withoutCredentials));
    expect(back.credentialRefs).toEqual([
      {
        nodeId: 'Buscar',
        nodeName: 'Buscar',
        type: 'httpBearer',
        id: 'cred-1',
        name: 'API de pedidos',
      },
    ]);
    expect(back.counts).toEqual({ nodes: 9, connections: 10 });
  });

  it('FR-013: gera ids, posiciona os nós e preenche os parâmetros omitidos', () => {
    const result = fromWorkflowFile(
      {
        nodes: [
          { name: 'Início', type: 'trigger.manual' },
          { name: 'Definir', type: 'data.set', parameters: { fields: [] } },
          { name: 'Legado', type: 'data.set', parameters: { keepOnlySet: false } },
        ],
        connections: {
          Início: { main: [[{ node: 'Definir', type: 'main', index: 0 }]] },
          Definir: { main: [[{ node: 'Legado', type: 'main', index: 0 }]] },
        },
      },
      { catalog, newId },
    );
    expect(result.issues.errors).toEqual([]);
    const [inicio, definir, legado] = result.definition.nodes;
    expect(inicio?.id).toMatch(/^gen-/);
    expect(inicio?.position).toEqual([0, 0]);
    expect(definir?.position).toEqual([260, 0]);
    expect(legado?.position).toEqual([520, 0]);
    expect(definir?.params).toEqual({ fields: [], includeOtherFields: false });
    // Nó no modo legado (`keepOnlySet`): os padrões novos não são aplicados.
    expect(legado?.params).toEqual({ keepOnlySet: false });
  });

  it('FR-016: tipo desconhecido vira marcador desabilitado, com o conteúdo original e as portas', () => {
    const result = fromWorkflowFile(
      {
        nodes: [
          { name: 'Início', type: 'trigger.manual', position: [0, 0] },
          {
            name: 'Slack',
            type: 'outro.slack',
            typeVersion: 2,
            position: [200, 0],
            parameters: { canal: '#geral' },
            credentials: { slackApi: { id: '9', name: 'Slack' } },
          },
          { name: 'Fim', type: 'data.set', position: [400, 0] },
        ],
        connections: {
          Início: { main: [[{ node: 'Slack', type: 'main', index: 0 }]] },
          Slack: { main: [[], [{ node: 'Fim', type: 'main', index: 0 }]] },
        },
      },
      { catalog, newId },
    );
    expect(result.issues.errors).toEqual([]);
    const slack = result.definition.nodes[1];
    expect(slack).toMatchObject({ type: 'placeholder.unsupported', disabled: true });
    expect(slack?.params).toMatchObject({
      originalType: 'outro.slack',
      originalTypeVersion: 2,
      ports: { inputs: ['main'], outputs: ['main', 'main'] },
    });
    const original = JSON.parse(String(slack?.params.originalJson)) as Record<string, unknown>;
    expect(original.parameters).toEqual({ canal: '#geral' });
    expect(original.credentials).toBeUndefined();
    expect(result.definition.edges.map((e) => `${e.fromPort}->${e.toPort}`)).toEqual([
      'main->in0',
      'out1->main',
    ]);
    expect(result.issues.pending).toEqual([
      expect.objectContaining({ code: 'UNSUPPORTED_NODE', node: 'Slack' }),
    ]);
  });

  it('FR-005: recusa versão do formato mais nova; aceita sem metadados', () => {
    const newer = fromWorkflowFile(
      { nodes: [], connections: {}, meta: { ollyFlow: { formatVersion: 2 } } },
      { catalog, newId },
    );
    expect(newer.issues.errors).toEqual([
      expect.objectContaining({ code: 'FORMAT_VERSION_UNSUPPORTED' }),
    ]);
    const empty = fromWorkflowFile({ nodes: [], connections: {} }, { catalog, newId });
    expect(empty.issues.errors).toEqual([]);
    expect(empty.definition).toEqual({ nodes: [], edges: [], settings: {} });
  });

  it('FR-012: nomes repetidos, conexões para nós inexistentes e portas que não existem', () => {
    const result = fromWorkflowFile(
      {
        nodes: [
          { name: 'A', type: 'data.set' },
          { name: 'A', type: 'data.set' },
          { name: 'B', type: 'http.request' },
          { name: 'C', type: 'http.request', typeVersion: 5 },
        ],
        connections: {
          A: { main: [[{ node: 'Fantasma', type: 'main', index: 0 }]] },
          B: { main: [[], [{ node: 'A', type: 'main', index: 0 }]] },
          Z: { main: [[{ node: 'A', type: 'main', index: 0 }]] },
        },
      },
      { catalog, newId },
    );
    expect(result.issues.errors.map((e) => e.code).sort()).toEqual(
      [
        'CONNECTION_UNKNOWN_NODE',
        'CONNECTION_UNKNOWN_NODE',
        'CONNECTION_UNKNOWN_PORT',
        'DUPLICATE_NODE_NAME',
        'TYPE_VERSION_UNSUPPORTED',
      ].sort(),
    );
    expect(
      result.issues.errors.find((e) => e.code === 'CONNECTION_UNKNOWN_PORT')?.message,
    ).toContain('continueErrorOutput');
  });

  it('FR-016 (formato errado): tipos do N8N no formato do Olly Flow sugerem o formato N8N', () => {
    const result = fromWorkflowFile(
      { nodes: [{ name: 'X', type: 'n8n-nodes-base.set' }], connections: {} },
      { catalog, newId },
    );
    expect(result.issues.errors).toEqual([expect.objectContaining({ code: 'N8N_FILE' })]);
    expect(result.issues.errors[0]?.message).toContain('"N8N"');
  });

  it('FR-018/SC-005: conteúdo hostil (chaves de protótipo, aninhamento, quantidade de nós)', () => {
    const proto = JSON.parse(
      '{"nodes":[{"name":"A","type":"data.set","parameters":{"__proto__":{"x":1}}}],"connections":{}}',
    ) as unknown;
    expect(fromWorkflowFile(proto, { catalog, newId }).issues.errors[0]?.code).toBe(
      'IMPORT_FORBIDDEN_KEY',
    );
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = { a: deep };
    expect(checkUntrusted(deep, 64)?.code).toBe('IMPORT_TOO_DEEP');
    expect(checkUntrusted({ a: { b: 1 } }, 64)).toBeUndefined();
    const many = {
      nodes: Array.from({ length: 3 }, (_, i) => ({ name: `n${String(i)}`, type: 'data.set' })),
      connections: {},
    };
    expect(
      fromWorkflowFile(many, { catalog, newId, limits: { maxNodes: 2, maxDepth: 64 } }).issues
        .errors[0]?.code,
    ).toBe('IMPORT_TOO_MANY_NODES');
    for (const bad of [null, [], 'x', { nodes: 'x', connections: {} }, { nodes: [] }]) {
      expect(fromWorkflowFile(bad, { catalog, newId }).issues.errors[0]?.code).toBe(
        'IMPORT_INVALID',
      );
    }
  });

  it('FR-009/FR-004: dados fixados por nome e configurações (com aviso da combinação sem equivalente)', () => {
    const result = fromWorkflowFile(
      {
        nodes: [{ name: 'A', type: 'trigger.manual' }],
        connections: {},
        pinData: { A: [{ json: { x: 1 } }, { y: 2 }], Fantasma: [{ json: {} }] },
        settings: {
          saveDataSuccessExecution: 'all',
          saveDataErrorExecution: 'none',
          executionTimeout: -1,
          executionOrder: 'v1',
        },
      },
      { catalog, newId },
    );
    const id = result.definition.nodes[0]?.id ?? '';
    expect(result.definition.pinData).toEqual({ [id]: [{ json: { x: 1 } }, { json: { y: 2 } }] });
    expect(result.definition.settings).toEqual({ saveExecutionData: 'all' });
    expect(result.issues.warnings.map((w) => w.code).sort()).toEqual([
      'PINDATA_UNKNOWN_NODE',
      'SETTINGS_SAVE_DATA',
    ]);
  });

  it('FR-020: colar fragmento sem "connections"; sub-nó sem posição fica embaixo do nó pai', () => {
    const result = fromWorkflowFile(
      {
        nodes: [
          { name: 'Agente', type: 'ai.agent', position: [500, 100] },
          { name: 'Modelo', type: 'ai.chatModel' },
        ],
        connections: {
          Modelo: { ai_languageModel: [[{ node: 'Agente', type: 'ai_languageModel', index: 0 }]] },
        },
      },
      { catalog, newId, fragment: true },
    );
    expect(result.issues.errors).toEqual([]);
    expect(result.definition.nodes[1]?.position).toEqual([380, 320]);
    expect(
      fromWorkflowFile({ nodes: [] }, { catalog, newId, fragment: true }).issues.errors,
    ).toEqual([]);
  });
});

describe('spec 015 — FR-014: resolução das credenciais no destino', () => {
  const available = [
    { id: 'a', type: 'httpBearer', name: 'API' },
    { id: 'b', type: 'httpBasic', name: 'API' },
    { id: 'c', type: 'httpBearer', name: 'Dupla' },
    { id: 'd', type: 'httpBearer', name: 'Dupla' },
  ];
  const ref = (extra: Record<string, string>) => ({
    nodeId: 'n',
    nodeName: 'N',
    type: 'httpBearer',
    ...extra,
  });

  it('pelo id do mesmo tipo; senão pelo nome e tipo com correspondência única', () => {
    expect(resolveCredentialRef(ref({ id: 'a' }), available)?.id).toBe('a');
    expect(resolveCredentialRef(ref({ id: 'b', name: 'API' }), available)?.id).toBe('a');
    expect(resolveCredentialRef(ref({ name: 'Dupla' }), available)).toBeUndefined();
    expect(resolveCredentialRef(ref({ name: 'Outra' }), available)).toBeUndefined();
    expect(resolveCredentialRef(ref({ id: 'a' }), available, ['httpBasic'])).toBeUndefined();
  });
});
