import { ExpressionError } from '@olly/expressions';
import { IsolateEvaluator } from '@olly/expressions/isolate';
import {
  NodeRegistry,
  createNodeRegistry,
  manualTrigger,
  setNode,
  type NodeDefinition,
} from '@olly/nodes';
import type { Edge, Item, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { afterAll, describe, expect, it } from 'vitest';
import { runWorkflow, type NodeRunRecord } from './run.js';

// Limite folgado: estes testes verificam semântica, não o timeout (ver sandbox.test.ts).
const evaluator = new IsolateEvaluator({ timeoutMs: 2000 });
afterAll(() => {
  evaluator.disposeAll();
});

/** Nó de teste que mantém só os itens com `json.manter` verdadeiro, como um If/Filter. */
const filterNode: NodeDefinition = {
  ...setNode,
  type: 'data.filtroTeste',
  execute: (input) =>
    Promise.resolve({
      main: input.items.flatMap((item, i) =>
        item.json.manter ? [{ json: item.json, pairedItem: { item: i } }] : [],
      ),
    }),
};
/** Nó de teste que grava a variável `ultimo` com o parâmetro `valor`. */
const setVarNode: NodeDefinition = {
  ...setNode,
  type: 'data.varTeste',
  execute: (input, ctx) => {
    input.items.forEach((_, i) => {
      ctx.setVariable('ultimo', ctx.getParam('valor', i));
    });
    return Promise.resolve({ main: input.items });
  },
};
const registry = new NodeRegistry();
for (const n of [manualTrigger, setNode, filterNode, setVarNode]) registry.register(n);

const manual = (): WorkflowNode => ({
  id: 'm',
  type: 'trigger.manual',
  name: 'Início',
  params: {},
  position: [0, 0],
});
const set = (id: string, name: string, fields: unknown[]): WorkflowNode => ({
  id,
  type: 'data.set',
  name,
  params: { fields, includeOtherFields: true },
  position: [0, 0],
});
const edge = (from: string, to: string): Edge => ({
  id: `${from}-${to}`,
  from,
  fromPort: 'main',
  to,
  toPort: 'main',
});
const def = (
  nodes: WorkflowNode[],
  edges: Edge[],
  pinData?: Record<string, Item[]>,
): WorkflowDefinition => ({
  nodes,
  edges,
  settings: {},
  ...(pinData && { pinData }),
});

describe('spec 003 — HU-1: expressões no motor', () => {
  it('FR-001/FR-002: resolve template com dados do item', async () => {
    const result = await runWorkflow(
      def(
        [
          manual(),
          set('s', 'Saudação', [{ name: 'msg', type: 'string', value: '=Olá {{ $json.nome }}' }]),
        ],
        [edge('m', 's')],
      ),
      registry,
      { evaluator, triggerItems: [{ json: { nome: 'Ana' } }, { json: { nome: 'Bruno' } }] },
    );
    expect(result.nodes.s?.output?.main?.map((i) => i.json.msg)).toEqual(['Olá Ana', 'Olá Bruno']);
  });

  it('FR-004/HU-1.2: $("Nó").item acha o item certo mesmo depois de um filtro', async () => {
    const result = await runWorkflow(
      def(
        [
          manual(),
          set('busca', 'Busca', [{ name: 'id', type: 'number', value: '={{ $itemIndex + 100 }}' }]),
          { id: 'f', type: 'data.filtroTeste', name: 'Filtro', params: {}, position: [0, 0] },
          set('s', 'Depois', [
            { name: 'idDaBusca', type: 'string', value: "={{ $('Busca').item.json.id }}" },
          ]),
        ],
        [edge('m', 'busca'), edge('busca', 'f'), edge('f', 's')],
      ),
      registry,
      {
        evaluator,
        triggerItems: [
          { json: { manter: false } },
          { json: { manter: true } },
          { json: { manter: true } },
        ],
      },
    );
    expect(result.status).toBe('success');
    expect(result.nodes.s?.output?.main?.map((i) => i.json.idDaBusca)).toEqual(['101', '102']);
  });

  it('FR-007: erro de expressão interrompe com nó, parâmetro e trecho', async () => {
    const errors: Error[] = [];
    const result = await runWorkflow(
      def(
        [
          manual(),
          set('s', 'Quebrado', [{ name: 'x', type: 'string', value: '={{ $json.a.b.c }}' }]),
        ],
        [edge('m', 's')],
      ),
      registry,
      { evaluator, callbacks: { onNodeError: (_id, e) => void errors.push(e) } },
    );
    expect(result.status).toBe('error');
    expect(errors[0]).toBeInstanceOf(ExpressionError);
    expect(result.error?.message).toContain(
      'parâmetro "fields[0].value" do nó "Quebrado" (item 0)',
    );
    expect(result.error?.message).toContain('Trecho: {{ $json.a.b.c }}');
  });

  it('FR-006: sem avaliador, workflow com expressões falha com mensagem clara', async () => {
    const result = await runWorkflow(
      def(
        [manual(), set('s', 'S', [{ name: 'x', type: 'string', value: '={{ 1 }}' }])],
        [edge('m', 's')],
      ),
      registry,
    );
    expect(result.error?.message).toMatch(/não há avaliador/);
  });

  it('FR-009: variável gravada é lida por nós seguintes em $vars', async () => {
    const result = await runWorkflow(
      def(
        [
          manual(),
          {
            id: 'v',
            type: 'data.varTeste',
            name: 'Var',
            params: { valor: '={{ $json.n * 10 }}' },
            position: [0, 0],
          },
          set('s', 'Usa', [{ name: 'lido', type: 'number', value: '={{ $vars.ultimo }}' }]),
        ],
        [edge('m', 'v'), edge('v', 's')],
      ),
      registry,
      { evaluator, triggerItems: [{ json: { n: 1 } }, { json: { n: 2 } }] },
    );
    expect(result.vars).toEqual({ ultimo: 20 });
    expect(result.nodes.s?.output?.main?.map((i) => i.json.lido)).toEqual([20, 20]);
  });

  it('FR-003: $execution, $workflow e $env vêm das opções', async () => {
    const result = await runWorkflow(
      def(
        [
          manual(),
          set('s', 'S', [
            {
              name: 'x',
              type: 'string',
              value:
                '={{ $execution.id }}|{{ $execution.mode }}|{{ $workflow.name }}|{{ $env.URL }}',
            },
          ]),
        ],
        [edge('m', 's')],
      ),
      registry,
      {
        evaluator,
        executionId: 'exec-9',
        mode: 'test',
        workflowName: 'Cadastro',
        env: { URL: 'https://x' },
      },
    );
    expect(result.nodes.s?.output?.main?.[0]?.json.x).toBe('exec-9|test|Cadastro|https://x');
  });
});

describe('spec 003 — HU-1.2: paired items através do logic.if', () => {
  it('FR-004/FR-010: depois do If, $("Busca").item ainda aponta o item de origem', async () => {
    const reg = createNodeRegistry();
    const result = await runWorkflow(
      def(
        [
          manual(),
          set('busca', 'Busca', [
            { name: 'id', type: 'number', value: '={{ $itemIndex + 1 }}' },
            { name: 'idade', type: 'number', value: '={{ $json.idade }}' },
          ]),
          {
            id: 'se',
            type: 'logic.if',
            name: 'Adulto?',
            params: {
              conditions: {
                combinator: 'and',
                conditions: [
                  {
                    leftValue: '={{ $json.idade }}',
                    rightValue: '18',
                    operator: { type: 'number', operation: 'gte' },
                  },
                ],
              },
            },
            position: [0, 0],
          },
          set('ok', 'Adultos', [
            { name: 'idOriginal', type: 'number', value: "={{ $('Busca').item.json.id }}" },
          ]),
        ],
        [
          edge('m', 'busca'),
          edge('busca', 'se'),
          { id: 'e-ok', from: 'se', fromPort: 'true', to: 'ok', toPort: 'main' },
        ],
      ),
      reg,
      {
        evaluator,
        triggerItems: [
          { json: { idade: 12 } },
          { json: { idade: 40 } },
          { json: { idade: 15 } },
          { json: { idade: 22 } },
        ],
      },
    );
    expect(result.status).toBe('success');
    expect(result.nodes.ok?.output?.main?.map((i) => i.json.idOriginal)).toEqual([2, 4]);
  });
});

describe('spec 003 — FR-016/FR-011: pin data e executar até um nó', () => {
  it('FR-016: nó fixado emite os dados fixados e não executa', async () => {
    let calls = 0;
    const counting: NodeDefinition = {
      ...setNode,
      type: 'data.contaTeste',
      execute: (i, c) => {
        calls++;
        return setNode.execute(i, c);
      },
    };
    const reg = createNodeRegistry([manualTrigger, setNode, counting]);
    const result = await runWorkflow(
      def(
        [
          manual(),
          {
            id: 'p',
            type: 'data.contaTeste',
            name: 'Fixado',
            params: { fields: [] },
            position: [0, 0],
          },
          set('s', 'Depois', [{ name: 'veio', type: 'string', value: '={{ $json.fixo }}' }]),
        ],
        [edge('m', 'p'), edge('p', 's')],
      ),
      reg,
      { evaluator, pinData: { p: [{ json: { fixo: 'sim' } }] } },
    );
    expect(calls).toBe(0);
    expect(result.nodes.p).toMatchObject({ status: 'success', pinned: true });
    expect(result.nodes.s?.output?.main?.[0]?.json.veio).toBe('sim');
  });

  it('FR-011: destinationNodeId executa só os ancestores e o próprio nó', async () => {
    const records: NodeRunRecord[] = [];
    const result = await runWorkflow(
      def(
        [manual(), set('a', 'A', []), set('b', 'B', []), set('c', 'C', [])],
        [edge('m', 'a'), edge('a', 'b'), edge('m', 'c')],
      ),
      registry,
      {
        evaluator,
        destinationNodeId: 'a',
        callbacks: { onNodeFinish: (r) => void records.push(r) },
      },
    );
    expect(Object.keys(result.nodes).sort()).toEqual(['a', 'm']);
    expect(records.map((r) => r.nodeName)).toEqual(['Início', 'A']);
  });

  it('FR-014: registros por nó trazem entrada, saída, origem dos itens e contagens', async () => {
    const records: NodeRunRecord[] = [];
    await runWorkflow(
      def([manual(), set('a', 'A', [{ name: 'k', type: 'number', value: '1' }])], [edge('m', 'a')]),
      registry,
      {
        evaluator,
        triggerItems: [{ json: { x: 1 } }],
        callbacks: { onNodeFinish: (r) => void records.push(r) },
      },
    );
    const a = records.find((r) => r.nodeId === 'a');
    expect(a).toMatchObject({
      status: 'success',
      itemsIn: 1,
      itemsOut: 1,
      inputs: { main: [{ json: { x: 1 } }] },
      inputSources: { main: [{ nodeId: 'm', port: 'main', index: 0 }] },
    });
    expect(a?.finishedAt.getTime()).toBeGreaterThanOrEqual(a?.startedAt.getTime() ?? 0);
  });
});

describe('spec 003 — FR-020: executar um nó reaproveitando a execução anterior', () => {
  const counted = (calls: Record<string, number>, base: NodeDefinition, type: string) => ({
    ...base,
    type,
    execute: (
      i: Parameters<NodeDefinition['execute']>[0],
      c: Parameters<NodeDefinition['execute']>[1],
    ) => {
      calls[c.node.id] = (calls[c.node.id] ?? 0) + 1;
      return base.execute(i, c);
    },
  });
  const reuseFrom = (records: NodeRunRecord[], ids: string[]) =>
    Object.fromEntries(
      records
        .filter((r) => ids.includes(r.nodeId))
        .map((r) => [
          r.nodeId,
          { inputs: r.inputs, inputSources: r.inputSources, output: r.output ?? {} },
        ]),
    );

  it('FR-020/HU-2.4: só o nó de destino executa; os anteriores reaproveitam a saída', async () => {
    const calls: Record<string, number> = {};
    const reg = createNodeRegistry([
      manualTrigger,
      counted(calls, filterNode, 'data.filtroTeste'),
      counted(calls, setNode, 'data.set'),
    ]);
    const workflow = def(
      [
        manual(),
        set('a', 'Busca', [{ name: 'id', type: 'number', value: '={{ $json.n }}' }]),
        { id: 'f', type: 'data.filtroTeste', name: 'Filtro', params: {}, position: [0, 0] },
        set('b', 'Usa', [
          { name: 'origem', type: 'number', value: "={{ $('Busca').item.json.id }}" },
        ]),
      ],
      [edge('m', 'a'), edge('a', 'f'), edge('f', 'b')],
    );
    const triggerItems = [{ json: { n: 1, manter: false } }, { json: { n: 2, manter: true } }];
    const first: NodeRunRecord[] = [];
    await runWorkflow(workflow, reg, {
      evaluator,
      triggerItems,
      destinationNodeId: 'f',
      callbacks: { onNodeFinish: (r) => void first.push(r) },
    });
    expect(calls).toEqual({ a: 1, f: 1 });

    const second: NodeRunRecord[] = [];
    const result = await runWorkflow(workflow, reg, {
      evaluator,
      destinationNodeId: 'b',
      runData: reuseFrom(first, ['m', 'a', 'f']),
      callbacks: { onNodeFinish: (r) => void second.push(r) },
    });
    expect(calls).toEqual({ a: 1, f: 1, b: 1 });
    // Paired items atravessam os nós reaproveitados: o item 0 do Filtro veio do item 1 da Busca.
    expect(result.nodes.b?.output?.main?.map((i) => i.json.origem)).toEqual([2]);
    expect(second.map((r) => [r.nodeId, r.reused])).toEqual([
      ['m', true],
      ['a', true],
      ['f', true],
      ['b', false],
    ]);
    expect(second.find((r) => r.nodeId === 'f')).toMatchObject({
      itemsIn: 2,
      itemsOut: 1,
      inputSources: first.find((r) => r.nodeId === 'f')?.inputSources,
    });
    expect(result.nodes.a).toMatchObject({ status: 'success', reused: true });
  });

  it('FR-020: o nó de destino e os nós fixados não usam runData', async () => {
    const calls: Record<string, number> = {};
    const reg = createNodeRegistry([manualTrigger, counted(calls, setNode, 'data.set')]);
    const stale = { inputs: {}, inputSources: {}, output: { main: [{ json: { velho: true } }] } };
    const result = await runWorkflow(
      def(
        [manual(), set('a', 'A', [{ name: 'k', type: 'number', value: '1' }]), set('b', 'B', [])],
        [edge('m', 'a'), edge('a', 'b')],
      ),
      reg,
      {
        evaluator,
        destinationNodeId: 'b',
        pinData: { a: [{ json: { fixo: true } }] },
        runData: { a: stale, b: stale },
      },
    );
    expect(calls).toEqual({ b: 1 });
    expect(result.nodes.a).toMatchObject({ pinned: true });
    expect(result.nodes.a?.reused).toBeUndefined();
    expect(result.nodes.b?.output?.main?.[0]?.json).toEqual({ fixo: true });
  });

  it('FR-020/FR-009: nó com rerunOnPartialExecution roda de novo e $vars chega aos seguintes', async () => {
    const reg = createNodeRegistry([
      manualTrigger,
      setNode,
      { ...setVarNode, rerunOnPartialExecution: true },
    ]);
    const workflow = def(
      [
        manual(),
        {
          id: 'v',
          type: 'data.varTeste',
          name: 'Var',
          params: { valor: '={{ $json.n * 10 }}' },
          position: [0, 0],
        },
        set('s', 'Usa', [{ name: 'lido', type: 'number', value: '={{ $vars.ultimo }}' }]),
      ],
      [edge('m', 'v'), edge('v', 's')],
    );
    const first: NodeRunRecord[] = [];
    await runWorkflow(workflow, reg, {
      evaluator,
      triggerItems: [{ json: { n: 3 } }],
      destinationNodeId: 'v',
      callbacks: { onNodeFinish: (r) => void first.push(r) },
    });
    const second: NodeRunRecord[] = [];
    const result = await runWorkflow(workflow, reg, {
      evaluator,
      destinationNodeId: 's',
      runData: reuseFrom(first, ['m', 'v']),
      callbacks: { onNodeFinish: (r) => void second.push(r) },
    });
    expect(second.map((r) => [r.nodeId, r.reused])).toEqual([
      ['m', true],
      ['v', false],
      ['s', false],
    ]);
    expect(result.vars).toEqual({ ultimo: 30 });
    expect(result.nodes.s?.output?.main?.[0]?.json.lido).toBe(30);
  });
});
