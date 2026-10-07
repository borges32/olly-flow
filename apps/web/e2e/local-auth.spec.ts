import { expect, test } from '@playwright/test';
import type { UserAdminSummary } from '@olly/shared-types';
import { ApiSession, createProject } from './support';

let admin: ApiSession;
let projectId: string;
const suffix = `${Date.now()}`;

test.beforeAll(async () => {
  ({
    admin,
    project: { id: projectId },
  } = await createProject({}));
});
test.afterAll(async () => {
  await admin.dispose();
});

test.describe('spec 014 — login local e IdP opcional', () => {
  test('SC-003/SC-006: usuário local troca a senha no primeiro acesso e trabalha no projeto; o IdP aparece junto', async ({
    page,
  }) => {
    const email = `local-${suffix}@olly.local`;
    // A administração cria o usuário local (senha inicial de troca obrigatória).
    const created = await admin.call('POST', '/admin/users', {
      name: 'Usuária Local',
      email,
      password: 'chave-inicial-segura',
    });
    expect(created.status).toBe(201);
    const user = created.body as UserAdminSummary;
    expect(
      (await admin.call('PUT', `/projects/${projectId}/members/${user.id}`, { role: 'editor' }))
        .status,
    ).toBe(200);

    await page.goto('/');
    // Com o IdP ativado, a tela oferece as duas formas de entrar.
    await expect(
      page.getByRole('button', { name: 'Entrar com conta institucional' }),
    ).toBeVisible();
    const form = page.getByTestId('login-form');
    await form.getByLabel('E-mail').fill(email);
    await form.getByLabel('Senha').fill('senha-errada-qualquer');
    await form.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos');
    await form.getByLabel('Senha').fill('chave-inicial-segura');
    await form.getByRole('button', { name: 'Entrar', exact: true }).click();

    // FR-007: troca obrigatória antes de usar a plataforma.
    const change = page.getByTestId('change-password-form');
    await change.getByLabel('Senha atual').fill('chave-inicial-segura');
    await change.getByLabel('Nova senha', { exact: true }).fill('nova-chave-segura-1');
    await change.getByLabel('Confirme a nova senha').fill('nova-chave-segura-1');
    await change.getByRole('button', { name: 'Salvar nova senha' }).click();
    await expect(page.getByTestId('user-name')).toHaveText('Usuária Local');

    // FR-012: trabalha no projeto conforme o papel.
    await page.goto('/workflows');
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
    // Sair encerra a sessão: volta à tela de entrada.
    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.getByTestId('login-form')).toBeVisible();
    // A nova senha vale.
    await page.getByTestId('login-form').getByLabel('E-mail').fill(email);
    await page.getByTestId('login-form').getByLabel('Senha').fill('nova-chave-segura-1');
    await page
      .getByTestId('login-form')
      .getByRole('button', { name: 'Entrar', exact: true })
      .click();
    await expect(page.getByTestId('user-name')).toHaveText('Usuária Local');
  });
});
