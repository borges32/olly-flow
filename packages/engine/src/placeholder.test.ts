import { createNodeRegistry } from '@olly/nodes';
import type { WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { runWorkflow } from './run.js';
import { unsupportedNodeIssues, validateWorkflow } from './validate.js';

const registry = createNodeRegistry();
const node = (id: string, type: string, extra: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id,
  type,
  name: id,
  params: {},
  position: [0, 0],
  ...extra,
});
const placeholder = (id: string, ports: { inputs: string[]; outputs: string[] }) =>
  node(id, 'placeholder.unsupported', {
    disabled: true,
    params: { originalType: 'n8n-nodes-base.slack', ports },
  });

describe('spec 015 — FR-016: nó marcador no motor', () => {
  it('desabilitado, repassa os itens; o rascunho valida, mas a publicação é bloqueada', async () => {
    const def: WorkflowDefinition = {
      nodes: [
        node('m', 'trigger.manual'),
        placeholder('p', { inputs: ['main'], outputs: ['main', 'main'] }),
        node('s', 'data.set', { params: { includeOtherFields: true, fields: [] } }),
      ],
      edges: [
        { id: 'e1', from: 'm', fromPort: 'main', to: 'p', toPort: 'in0' },
        { id: 'e2', from: 'p', fromPort: 'out0', to: 's', toPort: 'main' },
      ],
      settings: {},
    };
    expect(validateWorkflow(def, registry).errors).toEqual([]);
    expect(unsupportedNodeIssues(def)).toEqual([
      {
        code: 'UNSUPPORTED_NODE',
        message: 'Nó "p" não é suportado (n8n-nodes-base.slack): substitua-o antes de publicar',
        nodeIds: ['p'],
      },
    ]);
    const result = await runWorkflow(def, registry);
    expect(result.status).toBe('success');
    expect(result.nodes.s?.status).toBe('success');
  });

  it('com saídas de sub-nó, fica fora do agendamento (não executa no fluxo principal)', async () => {
    const def: WorkflowDefinition = {
      nodes: [node('m', 'trigger.manual'), placeholder('t', { inputs: [], outputs: ['ai_tool'] })],
      edges: [],
      settings: {},
    };
    const result = await runWorkflow(def, registry);
    expect(result.status).toBe('success');
    expect(result.nodes.t).toBeUndefined();
  });

  it('habilitado à mão, falha ao executar com a mensagem de não suportado', async () => {
    const def: WorkflowDefinition = {
      nodes: [
        node('m', 'trigger.manual'),
        { ...placeholder('p', { inputs: ['main'], outputs: ['main'] }), disabled: false },
      ],
      edges: [{ id: 'e1', from: 'm', fromPort: 'main', to: 'p', toPort: 'in0' }],
      settings: {},
    };
    const result = await runWorkflow(def, registry);
    expect(result.status).toBe('error');
    expect(JSON.stringify(result.nodes.p)).toContain('Nó não suportado');
  });
});
