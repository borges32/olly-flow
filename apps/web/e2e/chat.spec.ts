import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CredentialSummary, WorkflowDefinition, WorkflowNode } from '@olly/shared-types';
import { ApiSession, createProject, createWorkflow, loginViaUi } from './support';

let admin: ApiSession;
let editor: ApiSession;
let projectId: string;

test.beforeAll(async () => {
  ({
    admin,
    project: { id: projectId },
  } = await createProject({ editor: 'editor' }));
  editor = await ApiSession.login('editor');
  expect((await admin.call('PUT', '/ai-models/fake-model', { note: 'E2E' })).status).toBe(200);
});
test.afterAll(async () => {
  await editor.dispose();
  await admin.dispose();
});

/** Responde a última pergunta e conta as mensagens enviadas ao modelo (a memória aumenta). */
async function echoModel(): Promise<string> {
  const res = await editor.call('POST', `/projects/${projectId}/credentials`, {
    name: `Modelo ${String(Math.random())}`,
    type: 'fakeLlm',
    data: {
      script: JSON.stringify([
        { content: 'Recebi: {{lastHuman}} ({{messageCount}})', repeat: true },
      ]),
    },
  });
  expect(res.status).toBe(201);
  return (res.body as CredentialSummary).id;
}

/** Chat Trigger → Agent (prompt do item) com modelo simulado e memória persistente. */
async function chatAgent(chatParams: Record<string, unknown> = {}): Promise<WorkflowDefinition> {
  const credentialId = await echoModel();
  const sub = (from: string, kind: string, to = 'agent') => ({
    id: `${from}-${to}-${kind}`,
    from,
    fromPort: kind,
    to,
    toPort: kind,
  });
  const loadsHistory =
    (chatParams.options as { loadPreviousSession?: string } | undefined)?.loadPreviousSession ===
    'memory';
  const nodes: WorkflowNode[] = [
    {
      id: 'chat',
      type: 'trigger.chat',
      name: 'Chat',
      params: { webhookId: randomUUID(), ...chatParams },
      position: [0, 0],
    },
    {
      id: 'agent',
      type: 'ai.agent',
      name: 'Agente',
      params: { promptSource: 'fromInput' },
      position: [300, 0],
    },
    {
      id: 'model',
      type: 'ai.chatModel',
      name: 'Modelo',
      params: { model: 'fake-model' },
      credentialId,
      position: [250, 220],
    },
    {
      id: 'mem',
      type: 'memory.postgres',
      name: 'Memória',
      params: { sessionKey: '={{ $json.sessionId }}', contextWindowLength: 10 },
      position: [400, 220],
    },
  ];
  return {
    nodes,
    edges: [
      { id: 'e', from: 'chat', fromPort: 'main', to: 'agent', toPort: 'main' },
      sub('model', 'ai_languageModel'),
      sub('mem', 'ai_memory'),
      ...(loadsHistory ? [sub('mem', 'ai_memory', 'chat')] : []),
    ],
    settings: {},
  };
}

const count = (text: string) => Number(/\((\d+)\)/.exec(text)?.[1]);

test.describe('spec 021 — Chat Trigger', () => {
  test('SC-001/FR-002: conversa pelo painel do editor, com contexto e nova sessão', async ({
    page,
  }) => {
    const wf = await createWorkflow(editor, projectId, `Chat ${Date.now()}`, await chatAgent());
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByRole('button', { name: 'Abrir chat' }).click();
    const panel = page.getByTestId('chat-panel');
    await expect(panel).toBeVisible();

    const bot = panel.getByTestId('chat-message-bot');
    for (const text of ['Oi', 'Tudo bem?', 'Até logo']) {
      await panel.getByTestId('chat-input').fill(text);
      await panel.getByTestId('chat-input').press('Enter');
      await expect(bot.last()).toContainText(`Recebi: ${text}`);
    }
    const replies = await bot.allInnerTexts();
    expect(count(replies[1] ?? '')).toBeGreaterThan(count(replies[0] ?? ''));
    expect(count(replies[2] ?? '')).toBeGreaterThan(count(replies[1] ?? ''));
    // A execução de teste aparece no canvas, como a do "Executar workflow".
    await expect(page.getByTestId('node-Agente').getByTestId('node-status')).toHaveAttribute(
      'data-status',
      'success',
    );
    await expect(bot.last().getByRole('link', { name: 'Ver execução' })).toBeVisible();

    // SC-007/FR-016: os logs, ao lado do chat, listam os nós na ordem; o Agent mostra a saída e
    // os passos.
    const logs = page.getByTestId('logs-panel');
    await expect(logs.getByTestId('logs-list').getByRole('button')).toHaveText([/Chat/, /Agente/]);
    await logs.getByTestId('log-Agente').click();
    await expect(logs.getByTestId('logs-output')).toContainText('Recebi: Até logo');
    await expect(logs.getByTestId('logs-input')).toContainText('Até logo');
    await expect(logs.getByTestId('ndv-agent-steps')).toBeVisible();

    // Nova sessão: começa vazia e sem o contexto anterior.
    await panel.getByRole('button', { name: 'Nova sessão' }).click();
    await expect(bot).toHaveCount(0);
    await panel.getByTestId('chat-input').fill('Oi');
    await panel.getByTestId('chat-input').press('Enter');
    await expect(bot.last()).toContainText('Recebi: Oi');
    expect(count(await bot.last().innerText())).toBe(count(replies[0] ?? ''));
  });

  test('SC-007/FR-016: logs no pé do editor também sem chat, recolhidos até abrir', async ({
    page,
  }) => {
    const wf = await createWorkflow(editor, projectId, `Logs ${Date.now()}`, {
      nodes: [
        { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
        {
          id: 's',
          type: 'data.set',
          name: 'Montar',
          params: { fields: [{ name: 'x', type: 'number', value: '7' }] },
          position: [260, 0],
        },
      ],
      edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 's', toPort: 'main' }],
      settings: {},
    });
    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    const logs = page.getByTestId('logs-panel');
    await expect(logs).toHaveAttribute('data-open', 'false');
    await expect(page.getByRole('button', { name: 'Abrir chat' })).toHaveCount(0);
    await logs.getByRole('button', { name: /Logs/ }).click();
    await expect(logs.getByTestId('logs-empty')).toBeVisible();
    await page.getByRole('button', { name: 'Executar workflow' }).click();
    await expect(logs.getByTestId('logs-list').getByRole('button')).toHaveText([
      /Início/,
      /Montar/,
    ]);
    // Abre no último nó executado.
    await expect(logs.getByTestId('logs-output')).toContainText('7');
  });

  test('SC-002/SC-005/FR-003: página hospedada responde, recarrega o histórico e some ao despublicar', async ({
    browser,
  }) => {
    const def = await chatAgent({
      public: true,
      initialMessages: 'Olá! Sou o assistente de teste.',
      options: { title: 'Suporte E2E', loadPreviousSession: 'memory' },
    });
    const wf = await createWorkflow(editor, projectId, `Chat público ${Date.now()}`, def);
    const published = await editor.call('POST', `/workflows/${wf.id}/publish`, {
      message: 'Chat público',
    });
    expect(published.status).toBe(200);
    const webhookId = String(def.nodes[0]?.params.webhookId);

    // Visitante sem login na plataforma.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/chat/${webhookId}`);
    await expect(page.getByTestId('chat-title')).toHaveText('Suporte E2E');
    await expect(page.getByTestId('chat-message-bot').first()).toHaveText(
      'Olá! Sou o assistente de teste.',
    );
    await page.getByTestId('chat-input').fill('Preciso de ajuda');
    await page.getByTestId('chat-input').press('Enter');
    await expect(page.getByTestId('chat-message-bot').last()).toContainText(
      'Recebi: Preciso de ajuda',
    );

    // Recarregar: a conversa volta da memória (mesma sessão, guardada no navegador).
    await page.reload();
    await expect(page.getByTestId('chat-message-user')).toHaveText(['Preciso de ajuda']);
    await expect(page.getByTestId('chat-message-bot').last()).toContainText(
      'Recebi: Preciso de ajuda',
    );

    // Nova conversa: só as mensagens iniciais.
    await page.getByRole('button', { name: 'Nova conversa' }).click();
    await expect(page.getByTestId('chat-message-user')).toHaveCount(0);

    expect((await editor.call('POST', `/workflows/${wf.id}/unpublish`)).status).toBe(200);
    await page.reload();
    await expect(page.getByTestId('chat-unavailable')).toBeVisible();
    await context.close();
  });
});
