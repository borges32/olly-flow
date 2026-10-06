import type { Item, NodeOutput } from '@olly/shared-types';
import { NodeParameterError, errorJson, failedItem, itemErrorMode } from '../../errors.js';
import type { NodeContext, NodeDefinition, NodeExecuteInput } from '../../types.js';

type Outcome = { ok: true; items: Item[] } | { ok: false; error: unknown };

async function executeSubWorkflow(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput> {
  const gateway = ctx.subWorkflows();
  const workflowId = ctx.getParam('workflowId', 0);
  if (typeof workflowId !== 'string' || !workflowId.trim()) {
    throw new NodeParameterError('workflowId', 'selecione o workflow a chamar');
  }
  const wait = ctx.getParam('waitForCompletion', 0) !== false;
  const items = input.items;
  const call = async (batch: Item[]) =>
    gateway.run({ workflowId: workflowId.trim(), items: batch, wait, signal: ctx.signal });

  if (ctx.getParam('mode', 0) !== 'perItem') {
    // Uma chamada com todos os itens: a saída é a do último nó do filho.
    const result = await call(items);
    return {
      main: wait
        ? result.items.map((item) => ({ ...item, pairedItem: { item: 0 } }))
        : items.map((item, i) => ctx.helpers.pairedItem(item, i)),
    };
  }
  // Uma chamada por item, na ordem dos itens (SC-006).
  const mode = itemErrorMode(ctx.node.settings);
  const outcomes = await ctx.mapItems(items, async (item, i): Promise<Outcome> => {
    try {
      const result = await call([item]);
      return {
        ok: true,
        items: wait
          ? result.items.map((out) => ({ ...out, pairedItem: { item: i } }))
          : [ctx.helpers.pairedItem(item, i)],
      };
    } catch (error) {
      if (mode === 'stop') throw error;
      return { ok: false, error };
    }
  });
  const main: Item[] = [];
  const failed: Item[] = [];
  outcomes.forEach((outcome, i) => {
    if (outcome.ok) main.push(...outcome.items);
    else if (mode === 'errorOutput')
      failed.push(failedItem(outcome.error, items[i]?.json ?? {}, i));
    else main.push({ json: errorJson(outcome.error), pairedItem: { item: i } });
  });
  return mode === 'errorOutput' ? { main, error: failed } : { main };
}

/**
 * Executar sub-workflow (spec 008, FR-009, FR-010, plan §4): chama um workflow publicado, uma vez
 * ou por item, aguardando ou não o término. A API verifica a permissão do dono da execução, a
 * profundidade e a recursão. Equivale ao `n8n-nodes-base.executeWorkflow`.
 */
export const executeWorkflowNode: NodeDefinition = {
  type: 'flow.executeWorkflow',
  version: 1,
  displayName: 'Executar sub-workflow',
  description: 'Chama outro workflow publicado e recebe a saída do último nó.',
  icon: 'workflow',
  category: 'flow',
  inputs: [{ name: 'main', kind: 'main' }],
  outputs: [{ name: 'main', kind: 'main' }],
  paramsSchema: {
    type: 'object',
    required: ['workflowId'],
    properties: {
      workflowId: {
        type: 'string',
        title: 'Workflow',
        description: 'Workflow publicado, com o gatilho "Quando chamado por outro workflow".',
        default: '',
        'x-load-options': 'workflows',
        'x-no-expression': true,
      },
      mode: {
        type: 'string',
        title: 'Modo',
        description: '`once`: uma chamada com todos os itens; `perItem`: uma chamada por item.',
        enum: ['once', 'perItem'],
        default: 'once',
      },
      waitForCompletion: {
        type: 'boolean',
        title: 'Aguardar o término',
        description: 'Desligado: segue com os próprios itens enquanto o sub-workflow roda na fila.',
        default: true,
      },
    },
  } as NodeDefinition['paramsSchema'],
  supportsParallelItems: true,
  execute: executeSubWorkflow,
};
