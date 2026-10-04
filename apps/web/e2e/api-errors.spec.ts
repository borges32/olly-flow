import { expect, test } from '@playwright/test';
import { loginViaUi } from './support';

test('falha da API após o login mostra aviso claro, não um estado vazio', async ({ page }) => {
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'internal_error', message: 'Erro interno do servidor' },
      }),
    }),
  );
  await page.route('**/api/v1/projects', (route) => route.fulfill({ status: 500, body: '{}' }));
  await loginViaUi(page, 'admin');

  const alert = page.getByRole('alert').filter({ hasText: 'não conseguiu carregar seus dados' });
  await expect(alert).toBeVisible();
  await expect(page.getByText('Não foi possível carregar os projetos.')).toBeVisible();
  await expect(page.getByText('Você ainda não participa de nenhum projeto.')).toBeHidden();

  await page.unroute('**/api/v1/me');
  await page.unroute('**/api/v1/projects');
  await alert.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(alert).toBeHidden();
});
