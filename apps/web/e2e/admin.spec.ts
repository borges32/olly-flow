import { expect, test } from '@playwright/test';
import { ApiSession, loginViaUi } from './support';

test('spec 002 — FR-013: administrador cria projeto e gerencia membros e papéis pela UI', async ({
  page,
}) => {
  // O usuário precisa existir na plataforma (primeiro login) para ser encontrado.
  await (await ApiSession.login('executor')).dispose();
  const name = `Projeto UI ${Date.now()}`;

  await loginViaUi(page, 'admin', '/admin');
  await page.getByLabel('Nome do novo projeto').fill(name);
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await expect(page.getByText('Projeto criado')).toBeVisible();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  await page.getByLabel('Buscar usuário').fill('executor');
  await page
    .getByLabel('Usuário', { exact: true })
    .selectOption({ label: 'Ester Executora (executor@olly.local)' });
  await page.getByLabel('Papel', { exact: true }).selectOption('viewer');
  await page.getByRole('button', { name: 'Adicionar' }).click();

  const members = page.getByTestId('members');
  await expect(members).toContainText('executor@olly.local');
  const role = page.getByLabel('Papel de executor@olly.local');
  await expect(role).toHaveValue('viewer');
  await role.selectOption('executor');
  await expect(role).toHaveValue('executor');

  await page.getByRole('button', { name: 'Remover executor@olly.local' }).click();
  await expect(members).toContainText('Nenhum membro');
});

test('spec 002 — FR-013/NFR-002: quem não administra projetos não vê a administração', async ({
  page,
}) => {
  await loginViaUi(page, 'viewer');
  await expect(page.getByRole('link', { name: 'Administração' })).toBeHidden();
  await page.goto('/admin');
  await expect(page.getByText('Acesso restrito')).toBeVisible();
});
