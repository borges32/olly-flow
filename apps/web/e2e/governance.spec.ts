import { expect, test } from '@playwright/test';
import type { GroupRoleMapping, WorkflowDefinition } from '@olly/shared-types';
import {
  ApiSession,
  createProject,
  createWorkflow,
  loginViaUi,
  manualSetDefinition,
} from './support';

test.describe('spec 009 — SC-001/FR-005: papéis pelo grupo do IdP (Keycloak)', () => {
  test('SC-001/FR-005: grupo mapeado dá o papel no login; sem o mapeamento, o papel herdado sai', async ({
    page,
    browser,
  }) => {
    const { project, admin } = await createProject({});
    // Administração da plataforma mapeia o grupo `viewer` do Keycloak para Executor no projeto.
    await loginViaUi(page, 'admin', '/admin/sso');
    await page.getByLabel('Grupo do IdP').fill('viewer');
    await page.getByLabel('Projeto', { exact: true }).selectOption(project.id);
    await page.getByLabel('Papel', { exact: true }).selectOption('executor');
    await page.getByRole('button', { name: 'Mapear' }).click();
    const row = page.getByTestId('group-mappings').getByRole('row', { name: project.name });
    await expect(row).toContainText('Executor');

    // Login institucional do usuário do grupo: já é executor no projeto.
    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await loginViaUi(viewerPage, 'viewer', `/workflows?project=${project.id}`);
    await expect(viewerPage.getByLabel('Projeto')).toHaveValue(project.id);
    const viewer = await ApiSession.login('viewer');
    expect(viewer.me.permissions.projects[project.id]).toContain('workflow:execute');

    // A tela do projeto mostra o vínculo como herdado do IdP.
    await page.goto('/admin');
    await page.getByRole('button', { name: project.name }).click();
    await expect(
      page.getByTestId('members').getByRole('row', { name: /viewer@olly\.local/ }),
    ).toContainText('IdP');

    // Remove o mapeamento: no próximo login, o papel herdado sai.
    await page.goto('/admin/sso');
    await page.getByRole('button', { name: 'Remover mapeamento de viewer' }).click();
    await expect(page.getByTestId('group-mappings')).not.toContainText(project.name);
    const mappings = (await admin.call('GET', '/sso/group-mappings')).body as GroupRoleMapping[];
    expect(mappings.some((m) => m.projectId === project.id)).toBe(false);
    const again = await ApiSession.login('viewer');
    const login = await again.call('POST', '/auth/login');
    expect(login.status).toBe(200);
    expect((await again.call('GET', '/me')).body).not.toHaveProperty([
      'permissions',
      'projects',
      project.id,
    ]);

    await viewer.dispose();
    await again.dispose();
    await viewerContext.close();
    await admin.dispose();
  });
});

test.describe('spec 009 — FR-008/FR-010/SC-005: histórico e diff visual', () => {
  test('FR-010/SC-005: compara versões no canvas e restaura como nova versão', async ({ page }) => {
    const { project, admin } = await createProject({ editor: 'editor' });
    const wf = await createWorkflow(admin, project.id, 'Histórico E2E', manualSetDefinition);
    const [trigger, set] = manualSetDefinition.nodes;
    if (!trigger || !set) throw new Error('definição inesperada');
    const v2: WorkflowDefinition = {
      ...manualSetDefinition,
      nodes: [
        trigger,
        {
          ...set,
          params: {
            fields: [{ name: 'cliente.nome', type: 'string', value: 'Bia' }],
            keepOnlySet: false,
          },
        },
        {
          id: 'n',
          type: 'data.set',
          name: 'Novo passo',
          params: { fields: [] },
          position: [600, 0],
        },
      ],
      edges: [
        ...manualSetDefinition.edges,
        { id: 'e2', from: 's', fromPort: 'main', to: 'n', toPort: 'main' },
      ],
    };
    expect(
      (
        await admin.call('PUT', `/workflows/${wf.id}`, {
          definition: v2,
          baseVersion: 1,
          message: 'Troca o nome e adiciona um passo',
        })
      ).status,
    ).toBe(200);

    await loginViaUi(page, 'editor', `/workflows/${wf.id}`);
    await page.getByRole('button', { name: 'Histórico' }).click();
    const history = page.getByTestId('version-history');
    await expect(history.getByTestId('version-2')).toContainText(
      'Troca o nome e adiciona um passo',
    );
    await history
      .getByTestId('version-1')
      .getByRole('button', { name: 'Comparar com a atual' })
      .click();

    // FR-010: diff no canvas (alterado e adicionado) e patch dos parâmetros no painel.
    await expect(page.getByTestId('diff-banner')).toContainText('Comparando v1 com v2');
    await expect(page.getByTestId(`node-${set.name}`)).toHaveAttribute('data-diff', 'changed');
    await expect(page.getByTestId('node-Novo passo')).toHaveAttribute('data-diff', 'added');
    await expect(page.locator('path.olly-diff-edge-added')).toHaveCount(1);
    await expect(page.getByTestId(`diff-node-${set.name}`)).toContainText('"Ana" → "Bia"');
    await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toBeDisabled();
    await history.getByRole('button', { name: 'Sair da comparação' }).click();
    await expect(page.getByTestId('diff-banner')).toBeHidden();

    // SC-005: restaurar cria a versão 3 com a definição da 1.
    await history.getByTestId('version-1').getByRole('button', { name: 'Restaurar' }).click();
    await expect(page.getByText('Versão 1 restaurada como versão 3')).toBeVisible();
    await expect(history.getByTestId('version-3')).toContainText('Restaurada da versão 1');
    await expect(page.getByTestId('node-Novo passo')).toHaveCount(0);
    await admin.dispose();
  });
});
