import type {
  McpPoliciesRequest,
  McpServer,
  McpServerInput,
  WorkflowDefinition,
  WorkflowNode,
} from '@olly/shared-types';
import type { TestUser } from './test-app.js';

/** Cadastra e aprova um servidor MCP (spec 010) e, se pedido, libera tools. */
export async function registerMcpServer(
  admin: TestUser,
  input: McpServerInput,
  options: { approve?: boolean; allow?: string[]; projectId?: string | null } = {},
): Promise<McpServer> {
  const created = await admin.call('POST', '/mcp-servers', input);
  if (created.statusCode !== 201) {
    throw new Error(`cadastro MCP: ${created.statusCode} ${created.body}`);
  }
  let server = created.json<McpServer>();
  if (options.approve ?? true) {
    const approved = await admin.call('POST', `/mcp-servers/${server.id}/approve`);
    if (approved.statusCode !== 200) {
      throw new Error(`aprovação MCP: ${approved.statusCode} ${approved.body}`);
    }
    server = approved.json<McpServer>();
  }
  if (options.allow?.length) {
    const body: McpPoliciesRequest = {
      projectId: options.projectId ?? null,
      policies: options.allow.map((toolName) => ({ toolName, allowed: true, destructive: false })),
    };
    const res = await admin.call('PUT', `/mcp-servers/${server.id}/policies`, body);
    if (res.statusCode !== 200) throw new Error(`políticas MCP: ${res.statusCode} ${res.body}`);
  }
  return server;
}

/** Workflow Manual → Cliente MCP (`callTool` por padrão). */
export function mcpWorkflow(
  serverId: string,
  params: Record<string, unknown>,
  extra: Partial<WorkflowNode> = {},
): WorkflowDefinition {
  return {
    nodes: [
      { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
      {
        id: 'mcp',
        type: 'ai.mcpClient',
        name: 'MCP',
        params: { serverId, operation: 'callTool', argumentsMode: 'form', ...params },
        position: [200, 0],
        ...extra,
      },
    ],
    edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 'mcp', toPort: 'main' }],
    settings: {},
  };
}
