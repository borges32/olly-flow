import type { FakeModelStep } from '@olly/nodes';
import type { CredentialSummary, Edge, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import type { TestUser } from './test-app.js';

/** Credencial do modelo simulado (spec 011, FR-016) com o roteiro. */
export async function fakeModelCredential(
  user: TestUser,
  projectId: string,
  script: FakeModelStep[],
  name = `Modelo simulado ${Math.random().toString(36).slice(2, 8)}`,
): Promise<string> {
  const res = await user.call('POST', `/projects/${projectId}/credentials`, {
    name,
    type: 'fakeLlm',
    data: { script: JSON.stringify(script) },
  });
  if (res.statusCode !== 201) throw new Error(`credencial: ${res.statusCode} ${res.body}`);
  return res.json<CredentialSummary>().id;
}

const subEdge = (from: string, kind: 'ai_languageModel' | 'ai_memory' | 'ai_tool'): Edge => ({
  id: `${from}-${kind}`,
  from,
  fromPort: kind,
  to: 'agent',
  toPort: kind,
});

/**
 * Manual → Agent, com o modelo simulado e os sub-nós informados (ferramentas e memória). O
 * pedido vem de `$json.pergunta` (ou do campo informado).
 */
export function agentWorkflow(input: {
  credentialId: string;
  model?: string;
  tools?: WorkflowNode[];
  memory?: WorkflowNode;
  agentParams?: Record<string, unknown>;
  trigger?: WorkflowNode;
  pinData?: WorkflowDefinition['pinData'];
}): WorkflowDefinition {
  const trigger: WorkflowNode = input.trigger ?? {
    id: 'm',
    type: 'trigger.manual',
    name: 'Início',
    params: {},
    position: [0, 0],
  };
  const nodes: WorkflowNode[] = [
    trigger,
    {
      id: 'agent',
      type: 'ai.agent',
      name: 'Agente',
      params: { promptSource: 'define', text: '={{ $json.pergunta }}', ...input.agentParams },
      position: [300, 0],
    },
    {
      id: 'model',
      type: 'ai.chatModel',
      name: 'Modelo',
      params: { model: input.model ?? 'fake-model' },
      credentialId: input.credentialId,
      position: [300, 200],
    },
    ...(input.memory ? [input.memory] : []),
    ...(input.tools ?? []),
  ];
  const edges: Edge[] = [
    { id: 'e-main', from: trigger.id, fromPort: 'main', to: 'agent', toPort: 'main' },
    subEdge('model', 'ai_languageModel'),
    ...(input.memory ? [subEdge(input.memory.id, 'ai_memory')] : []),
    ...(input.tools ?? []).map((t) => subEdge(t.id, 'ai_tool')),
  ];
  return { nodes, edges, settings: {}, ...(input.pinData && { pinData: input.pinData }) };
}

/** Sub-nó `tool.mcp` com as tools liberadas do servidor. */
export const mcpToolNode = (serverId: string, id = 'tool-mcp'): WorkflowNode => ({
  id,
  type: 'tool.mcp',
  name: 'MCP',
  params: { serverId, tools: 'allowed' },
  position: [500, 200],
});

/** Cadastra modelos permitidos na instalação (spec 011, FR-002) pela administração. */
export async function allowModels(admin: TestUser, models: string[]): Promise<void> {
  for (const model of models) {
    const res = await admin.call('PUT', `/ai-models/${encodeURIComponent(model)}`, {});
    if (res.statusCode !== 200) throw new Error(`modelo ${model}: ${res.statusCode} ${res.body}`);
  }
}
