import { expect, test } from '@playwright/test';
import { startMcpTestServer, type McpTestServer } from '@olly/mcp-test-server';
import type {
  CredentialSummary,
  ExecutionDetail,
  McpServer,
  WorkflowDefinition,
  WorkflowNode,
} from '@olly/shared-types';
import { ApiSession, createProject, createWorkflow, loginViaUi } from './support';

let mcp: McpTestServer;
let admin: ApiSession;
let editor: ApiSession;
let projectId: string;
let serverId: string;
const suffix = `${Date.now()}`;

test.beforeAll(async () => {
  mcp = await startMcpTestServer();
  ({
    admin,
    project: { id: projectId },
  } = await createProject({ editor: 'editor', executor: 'executor' }));
  editor = await ApiSession.login('editor');
  // FR-002: modelo liberado na administração (vale na hora, sem reiniciar).
  expect((await admin.call('PUT', '/ai-models/fake-model', { note: 'E2E' })).status).toBe(200);
  const created = await admin.call('POST', '/mcp-servers', {
    name: `Agente ${suffix}`,
    transport: 'streamableHttp',
    url: `${mcp.url}/mcp`,
  });
  serverId = (created.body as McpServer).id;
  await admin.call('POST', `/mcp-servers/${serverId}/approve`);
  await admin.call('PUT', `/mcp-servers/${serverId}/policies`, {
    policies: [
      { toolName: 'soma', allowed: true, destructive: false },
      { toolName: 'apagar_registro', allowed: true, destructive: true },
    ],
  });
});
test.afterAll(async () => {
  await mcp.close();
  await editor.dispose();
  await admin.dispose();
});

/** Credencial do modelo simulado (só com NODE_ENV=test) com o roteiro. */
async function fakeModel(script: unknown[]): Promise<string> {
  const res = await editor.call('POST', `/projects/${projectId}/credentials`, {
    name: `Modelo ${String(Math.random())}`,
    type: 'fakeLlm',
    data: { script: JSON.stringify(script) },
  });
  expect(res.status).toBe(201);
  return (res.body as CredentialSummary).id;
}

function agentDefinition(credentialId: string, pergunta: string): WorkflowDefinition {
  const sub = (id: string, kind: string) => ({
    id: `${id}-${kind}`,
    from: id,
    fromPort: kind,
    to: 'agent',
    toPort: kind,
  });
  const nodes: WorkflowNode[] = [
    { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
    {
      id: 'agent',
      type: 'ai.agent',
      name: 'Agente',
      params: { promptSource: 'define', text: pergunta },
      position: [300, 0],
    },
    {
      id: 'model',
      type: 'ai.chatModel',
      name: 'Modelo',
      params: { model: 'fake-model' },
      credentialId,
      position: [200, 220],
    },
    {
      id: 'tools',
      type: 'tool.mcp',
      name: 'Ferramentas MCP',
      params: { serverId, tools: 'allowed' },
      position: [450, 220],
    },
  ];
  return {
    nodes,
    edges: [
      { id: 'e', from: 'm', fromPort: 'main', to: 'agent', toPort: 'main' },
      sub('model', 'ai_languageModel'),
      sub('tools', 'ai_tool'),
    ],
    settings: {},
  };
}

async function finished(executionId: string): Promise<ExecutionDetail> {
  let detail: ExecutionDetail | undefined;
  await expect
    .poll(
      async () => {
        detail = (await editor.call('GET', `/executions/${executionId}`)).body as ExecutionDetail;
        return detail.status;
      },
      { timeout: 20_000 },
    )
    .toMatch(/success|error/);
  return detail as ExecutionDetail;
}

test.describe('spec 011 — FR-002: modelos permitidos na administração', () => {
  test('FR-002: o admin libera e remove um modelo pela tela; a lista do nó acompanha', async ({
    page,
  }) => {
    const name = `modelo-e2e-${suffix}`;
    await loginViaUi(page, 'admin', '/admin/ai');
    const form = page.getByTestId('ai-model-form');
    await form.getByLabel('Modelo').fill(name);
    await form.getByLabel('Observação (opcional)').fill('Criado no E2E');
    await form.getByRole('button', { name: 'Liberar modelo' }).click();
    await expect(page.getByTestId(`ai-model-${name}`)).toContainText('Criado no E2E');
    // A lista do nó Modelo de chat (por projeto) já tem o modelo, sem reinício.
    const available = await editor.call('GET', `/projects/${projectId}/ai-models`);
    expect(available.body).toContain(name);

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: `Remover ${name}` }).click();
    await expect(page.getByTestId(`ai-model-${name}`)).toHaveCount(0);
    expect((await editor.call('GET', `/projects/${projectId}/ai-models`)).body).not.toContain(name);
  });
});

test.describe('spec 011 — HU-1: agente no editor', () => {
  test('FR-001/FR-006: sub-nós na base do Agent; passos visíveis no painel do nó', async ({
    page,
  }) => {
    const credentialId = await fakeModel([
      { toolCalls: [{ name: 'soma', args: { a: 20, b: 22 } }] },
      { content: 'A soma deu {{lastTool}}' },
    ]);
    const wf = await createWorkflow(
      editor,
      projectId,
      `Agente E2E ${suffix}`,
      agentDefinition(credentialId, 'Quanto é 20 + 22?'),
    );
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    const agent = page.getByTestId('node-Agente');
    // Entradas de sub-nó na base do Agent; o modelo é obrigatório.
    await expect(agent.getByTestId('port-ai_languageModel')).toHaveAttribute(
      'title',
      'Modelo (obrigatório)',
    );
    await expect(page.getByTestId('node-Modelo')).toHaveAttribute('data-subnode', 'true');
    await expect(page.locator('.olly-subnode-edge')).toHaveCount(2);

    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(agent.getByTestId('node-status')).toHaveAttribute('data-status', 'success');
    await agent.dblclick();
    await expect(page.getByTestId('ndv-output')).toContainText('A soma deu');
    const steps = page.getByTestId('ndv-agent-steps');
    await expect(steps.getByTestId('agent-step')).toHaveCount(4);
    await expect(steps).toContainText('soma');
    await expect(steps.getByTestId('agent-usage')).toContainText('tokens');
  });
});

test.describe('spec 011 — FR-007: tools MCP escolhidas na lista', () => {
  test('FR-007: "selected" mostra as tools liberadas com descrição e grava as escolhidas', async ({
    page,
  }) => {
    const credentialId = await fakeModel([{ content: 'ok' }]);
    const wf = await createWorkflow(
      editor,
      projectId,
      `Tools MCP E2E ${suffix}`,
      agentDefinition(credentialId, 'Oi'),
    );
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByTestId('node-Ferramentas MCP').dblclick();
    await page.getByTestId('param-tools').selectOption('selected');
    const field = page.getByTestId('param-toolNames');
    await field.click();
    const options = page.getByTestId('param-toolNames-option');
    await expect(options).toHaveCount(2);
    await expect(options.filter({ hasText: 'soma' })).toContainText('Soma dois números.');
    await options.filter({ hasText: 'soma' }).click();
    await expect(options.filter({ hasText: 'soma' })).toHaveAttribute('aria-selected', 'true');
    // Busca pelo nome; Esc fecha só a lista, não o painel.
    await page.getByRole('combobox', { name: 'Tools escolhidas' }).fill('apagar');
    await expect(options).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(options).toHaveCount(0);
    await expect(page.getByTestId('ndv')).toBeVisible();
    await expect(page.getByTestId('param-toolNames-chip')).toHaveText(['soma']);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Workflow salvo')).toBeVisible();
    const saved = (await editor.call('GET', `/workflows/${wf.id}`)).body as {
      definition: WorkflowDefinition;
    };
    const tools = saved.definition.nodes.find((n) => n.id === 'tools');
    expect(tools?.params).toMatchObject({ tools: 'selected', toolNames: [{ name: 'soma' }] });
  });
});

test.describe('spec 011 — HU-2/SC-003: aprovação humana', () => {
  test('FR-010/FR-011: a ação destrutiva espera; o executor aprova em Aprovações', async ({
    page,
  }) => {
    const credentialId = await fakeModel([
      { toolCalls: [{ name: 'apagar_registro', args: { id: 'e2e-1' } }] },
      { content: 'Feito: {{lastTool}}' },
    ]);
    const wf = await createWorkflow(
      editor,
      projectId,
      `Aprovação E2E ${suffix}`,
      agentDefinition(credentialId, 'Apague o registro e2e-1'),
    );
    const run = await editor.call('POST', `/workflows/${wf.id}/test-run`, {
      definition: wf.definition,
    });
    const executionId = (run.body as { executionId: string }).executionId;
    await expect
      .poll(
        async () =>
          ((await editor.call('GET', `/executions/${executionId}`)).body as ExecutionDetail).status,
      )
      .toBe('waiting');

    await loginViaUi(page, 'executor', '/approvals');
    const request = page.getByTestId('agent-approval-apagar_registro');
    await expect(request).toContainText('e2e-1');
    await expect(request).toContainText('exige aprovação humana');
    await request.getByLabel('Comentário').fill('ok pelo E2E');
    await request.getByRole('button', { name: 'Aprovar ação' }).click();
    await expect(page.getByText('Ação aprovada')).toBeVisible();

    const done = await finished(executionId);
    expect(done.status).toBe('success');
    expect(JSON.stringify(done.nodes.find((n) => n.nodeId === 'agent')?.output)).toContain(
      'Registro e2e-1 apagado',
    );
    await expect(page.getByTestId('agent-approvals-decided')).toContainText('ok pelo E2E');
  });
});
