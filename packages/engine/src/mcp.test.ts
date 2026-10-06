import { createNodeRegistry, type McpGateway } from '@olly/nodes';
import type { WorkflowDefinition } from '@olly/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { runWorkflow } from './run.js';

const definition: WorkflowDefinition = {
  nodes: [
    { id: 'm', type: 'trigger.manual', name: 'Manual', params: {}, position: [0, 0] },
    {
      id: 'mcp',
      type: 'ai.mcpClient',
      name: 'MCP',
      params: { serverId: 'srv', operation: 'listTools' },
      position: [200, 0],
    },
  ],
  edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'mcp', toPort: 'main' }],
  settings: {},
};

describe('spec 010 — plan §5: motor entrega o gateway MCP ao nó', () => {
  it('FR-011: o nó recebe o gateway e identifica nó e execução do nó (runIndex)', async () => {
    const listTools = vi.fn(() => Promise.resolve([]));
    const mcp = { listTools } as unknown as McpGateway;
    const result = await runWorkflow(definition, createNodeRegistry(), { mcp });
    expect(result.status).toBe('success');
    expect(result.nodes.mcp?.output?.main?.[0]?.json).toEqual({ tools: [] });
    expect(listTools).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'srv', nodeId: 'mcp', runIndex: 0, itemIndex: 0 }),
    );
  });

  it('FR-008: sem gateway, o nó falha com mensagem clara', async () => {
    const result = await runWorkflow(definition, createNodeRegistry());
    expect(result.status).toBe('error');
    expect(result.nodes.mcp?.error).toMatch(/Cliente MCP ainda não está disponível/);
  });
});
