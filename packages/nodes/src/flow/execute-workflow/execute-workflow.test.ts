import { describe, expect, it, vi } from 'vitest';
import { fakeContext } from '../../test-support/context.js';
import type { SubWorkflowGateway } from '../../types.js';
import { executeWorkflowTrigger } from '../../trigger/execute-workflow/definition.js';
import { executeWorkflowNode } from './definition.js';

const items = [{ json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 3 } }];

function gateway(): SubWorkflowGateway & { run: ReturnType<typeof vi.fn> } {
  return {
    describe: () => Promise.resolve({ name: 'filho', inputSchema: null }),
    run: vi.fn(async ({ items: batch }: { items: { json: { n?: number } }[] }) => {
      await new Promise((r) => setTimeout(r, Math.random() * 20));
      return {
        executionId: 'filha',
        status: 'success',
        items: batch.map((i) => ({ json: { dobro: (i.json.n ?? 0) * 2 } })),
      };
    }),
  };
}

describe('spec 008 — FR-009: Executar sub-workflow', () => {
  it('FR-009: uma vez, com todos os itens, devolve a saída do último nó do filho', async () => {
    const subWorkflows = gateway();
    const out = await executeWorkflowNode.execute(
      { inputs: { main: items }, items },
      fakeContext({ params: { workflowId: 'wf-filho', mode: 'once' }, subWorkflows }),
    );
    expect(subWorkflows.run).toHaveBeenCalledTimes(1);
    expect(subWorkflows.run).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-filho', items, wait: true }),
    );
    expect(out.main?.map((i) => i.json)).toEqual([{ dobro: 2 }, { dobro: 4 }, { dobro: 6 }]);
  });

  it('FR-009/SC-006: por item, em paralelo, preserva a ordem dos itens', async () => {
    const subWorkflows = gateway();
    const out = await executeWorkflowNode.execute(
      { inputs: { main: items }, items },
      fakeContext({
        params: { workflowId: 'wf-filho', mode: 'perItem' },
        subWorkflows,
        node: { settings: { parallelItems: { enabled: true, concurrency: 3 } } },
      }),
    );
    expect(subWorkflows.run).toHaveBeenCalledTimes(3);
    expect(out.main?.map((i) => [i.json, i.pairedItem])).toEqual([
      [{ dobro: 2 }, { item: 0 }],
      [{ dobro: 4 }, { item: 1 }],
      [{ dobro: 6 }, { item: 2 }],
    ]);
  });

  it('FR-009: sem aguardar, segue com os próprios itens', async () => {
    const subWorkflows = gateway();
    const out = await executeWorkflowNode.execute(
      { inputs: { main: items }, items },
      fakeContext({
        params: { workflowId: 'wf-filho', mode: 'once', waitForCompletion: false },
        subWorkflows,
      }),
    );
    expect(subWorkflows.run).toHaveBeenCalledWith(expect.objectContaining({ wait: false }));
    expect(out.main?.map((i) => i.json)).toEqual(items.map((i) => i.json));
  });

  it('FR-009: erro de um item com onError continue vira item de erro', async () => {
    const subWorkflows = gateway();
    subWorkflows.run.mockRejectedValueOnce(new Error('Recursão detectada'));
    const out = await executeWorkflowNode.execute(
      { inputs: { main: items }, items },
      fakeContext({
        params: { workflowId: 'wf', mode: 'perItem' },
        subWorkflows,
        node: { settings: { onError: 'continue' } },
      }),
    );
    expect(out.main?.[0]?.json).toEqual({ error: { message: 'Recursão detectada' } });
    expect(out.main).toHaveLength(3);
  });
});

describe('spec 008 — FR-011: gatilho do sub-workflow', () => {
  it('FR-011: valida os itens recebidos contra o schema', async () => {
    const schema = JSON.stringify({
      type: 'object',
      required: ['n'],
      properties: { n: { type: 'number' } },
    });
    const ok = await executeWorkflowTrigger.execute(
      { inputs: { main: items }, items },
      fakeContext({ params: { inputSchema: schema } }),
    );
    expect(ok.main).toHaveLength(3);
    await expect(
      executeWorkflowTrigger.execute(
        { inputs: { main: [{ json: { n: 'x' } }] }, items: [{ json: { n: 'x' } }] },
        fakeContext({ params: { inputSchema: schema } }),
      ),
    ).rejects.toThrow('Itens recebidos fora do schema do sub-workflow');
  });

  it('FR-011: sem chamador (teste no editor), emite um item vazio', async () => {
    const out = await executeWorkflowTrigger.execute(
      { inputs: {}, items: [] },
      fakeContext({ params: { inputSchema: '' } }),
    );
    expect(out.main).toEqual([{ json: {}, pairedItem: { item: 0 } }]);
  });
});
