import { expect, test, type Page } from '@playwright/test';
import type { OllyChatConfig, WorkflowDefinition } from '@olly/shared-types';
import { API_URL, ApiSession, createProject, createWorkflow, loginViaUi } from './support';

let admin: ApiSession;
let path: string;

/** Webhook (Streaming) → Esperar 1 s → `{ client, report }` montado com o payload do Olly Chat. */
const assistant = (webhookPath: string): WorkflowDefinition => ({
  nodes: [
    {
      id: 'w',
      type: 'trigger.webhook',
      name: 'Webhook',
      params: { httpMethod: 'POST', path: webhookPath, responseMode: 'streaming' },
      position: [0, 0],
    },
    {
      id: 'z',
      type: 'flow.wait',
      name: 'Analisando',
      params: { resume: 'timeInterval', amount: 1, unit: 'seconds' },
      position: [250, 0],
    },
    {
      id: 's',
      type: 'data.set',
      name: 'Resposta',
      params: {
        // Spec 028, FR-005/FR-011/FR-012: o JSON final traz o Markdown no `report`, com uma tabela, um flowchart
        // válido e outro bloco mermaid inválido (a própria mensagem).
        fields: [
          { name: 'client', type: 'string', value: 'chat-olly' },
          {
            name: 'report',
            type: 'string',
            value:
              '=**{{ $json.body.client }}** · sessão {{ $json.body.chatSessionId }} · {{ $json.body.login }}: {{ $json.body.message }}\n\n## Ações recomendadas\n| Prioridade | Ação |\n|---|---|\n| Imediata | Ajustar a memória |\n\n```mermaid\nflowchart LR\n  A[Pergunta] --> B[Resposta]\n```\n\n```mermaid\n{{ $json.body.message }}\n```',
          },
        ],
      },
      position: [500, 0],
    },
  ],
  edges: [
    { id: 'e1', from: 'w', fromPort: 'main', to: 'z', toPort: 'main' },
    { id: 'e2', from: 'z', fromPort: 'main', to: 's', toPort: 'main' },
  ],
  settings: {},
});

test.beforeAll(async () => {
  let projectId: string;
  ({
    admin,
    project: { id: projectId },
  } = await createProject({}));
  path = `assistente-e2e-${String(Date.now())}`;
  const wf = await createWorkflow(admin, projectId, 'Assistente E2E', assistant(path));
  expect(
    (await admin.call('POST', `/workflows/${wf.id}/publish`, { message: 'Assistente' })).status,
  ).toBe(200);
  const saved = await admin.call('PUT', '/admin/olly-chat', {
    webhookUrl: `${API_URL}/webhook/${path}`,
    retentionDays: 7,
    authType: 'none',
  });
  expect(saved.status).toBe(200);
});
test.afterAll(async () => {
  await admin.dispose();
});

const sessionNumber = async (page: Page) =>
  Number(/Sessão (\d+)/.exec(await page.getByTestId('olly-chat-title').innerText())?.[1]);

test.describe('spec 028 — Olly Chat', () => {
  test('FR-001/FR-002/FR-005/FR-006/FR-011/FR-012/SC-001/SC-002/SC-005/SC-006: o viewer conversa, volta à sessão, renomeia e exclui', async ({
    page,
  }) => {
    await loginViaUi(page, 'viewer', '/');
    await page.getByRole('link', { name: 'Olly Chat' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Olly Chat');
    await expect(page).toHaveURL(/\/assistente$/);

    // Na primeira visita há uma sessão pronta; depois, uma nova pelo botão.
    await expect(page.getByTestId('olly-chat-title')).toHaveText(/^Sessão \d+/);
    await page.getByRole('button', { name: 'Nova sessão' }).click();
    await expect(page.getByRole('button', { name: 'Nova sessão' })).toBeEnabled();
    await expect(page.getByTestId('olly-chat-title')).toHaveText(/^Sessão \d+$/);
    const number = await sessionNumber(page);

    await page.getByTestId('chat-input').fill('Analise o mobile pf');
    await page.getByTestId('chat-input').press('Enter');
    // FR-005: passo atual (nome do nó) e depois a resposta, com Markdown.
    await expect(page.getByTestId('chat-step')).toHaveText(/Executando: Analisando/);
    const answer = page.getByTestId('chat-message-bot').last();
    await expect(answer).toContainText(`sessão ${String(number)} · `);
    await expect(answer).toContainText('Analise o mobile pf');
    await expect(answer.locator('strong')).toHaveText('chat-olly');
    // FR-012/SC-006: título e tabela GFM formatados.
    await expect(answer.getByRole('heading', { name: 'Ações recomendadas' })).toBeVisible();
    await expect(answer.getByRole('columnheader')).toHaveText(['Prioridade', 'Ação']);
    await expect(answer.getByRole('cell')).toHaveText(['Imediata', 'Ajustar a memória']);
    // SC-005: o bloco mermaid do `report` vira um diagrama, não código.
    await expect(answer.getByTestId('mermaid-diagram').locator('svg')).toBeVisible();
    await expect(answer.getByTestId('mermaid-diagram')).toContainText('Pergunta');
    await expect(answer).not.toContainText('flowchart LR');
    // FR-011: o segundo bloco (a mensagem, que não é um diagrama) mostra o código e o aviso.
    await expect(answer.getByTestId('mermaid-error')).toContainText(
      'Não foi possível desenhar o diagrama',
    );
    await expect(answer.getByTestId('mermaid-error').locator('pre')).toHaveText(
      'Analise o mobile pf',
    );
    // O título ganha o começo da primeira mensagem.
    await expect(page.getByTestId(`olly-chat-session-${String(number)}`)).toHaveText(
      `Sessão ${String(number)} · Analise o mobile pf`,
    );

    // Outra sessão, e de volta à primeira depois de recarregar: o histórico está lá.
    await page.getByRole('button', { name: 'Nova sessão' }).click();
    await expect(page.getByTestId('olly-chat-title')).toHaveText(`Sessão ${String(number + 1)}`);
    await page.reload();
    await page.getByTestId(`olly-chat-session-${String(number)}`).click();
    await expect(page.getByTestId('chat-message-user')).toHaveText(['Analise o mobile pf']);
    await expect(page.getByTestId('chat-message-bot').last()).toContainText('Analise o mobile pf');

    // Renomear.
    await page
      .getByRole('button', { name: `Renomear Sessão ${String(number)} · Analise o mobile pf` })
      .click();
    await page.getByLabel('Título da sessão').fill('Mobile PF');
    await page.getByRole('button', { name: 'Salvar título' }).click();
    await expect(page.getByTestId(`olly-chat-session-${String(number)}`)).toHaveText('Mobile PF');

    // Excluir, com confirmação.
    await page.getByRole('button', { name: 'Excluir Mobile PF' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click();
    await expect(page.getByTestId(`olly-chat-session-${String(number)}`)).toHaveCount(0);
  });

  test('FR-008: a administração configura o chat na aba Chat', async ({ page }) => {
    await loginViaUi(page, 'admin', '/admin/chat');
    await expect(page.getByLabel('URL do webhook do workflow')).toHaveValue(
      `${API_URL}/webhook/${path}`,
    );
    await page.getByLabel('Retenção das sessões (dias)').fill('10');
    await page.getByLabel('Autenticação do webhook').selectOption('headerAuth');
    await page.getByLabel('Nome do cabeçalho').fill('x-chave');
    await page.getByLabel('Valor').fill('segredo-e2e');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Configuração do chat salva')).toBeVisible();
    const config = (await admin.call('GET', '/admin/olly-chat')).body as OllyChatConfig;
    expect(config).toMatchObject({
      retentionDays: 10,
      authType: 'headerAuth',
      headerName: 'x-chave',
      hasSecret: true,
    });
    expect(JSON.stringify(config)).not.toContain('segredo-e2e');
    // O segredo não volta para a tela.
    await page.reload();
    await expect(page.getByLabel('Valor')).toHaveValue('');
    await expect(page.getByLabel('Valor')).toHaveAttribute('placeholder', /manter o atual/);
    // Volta à configuração do outro teste.
    await admin.call('PUT', '/admin/olly-chat', {
      webhookUrl: `${API_URL}/webhook/${path}`,
      retentionDays: 7,
      authType: 'none',
    });
  });
});
