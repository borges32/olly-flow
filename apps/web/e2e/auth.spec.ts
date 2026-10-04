import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'olly123';

/** Preenche o formulário de login do IdP de desenvolvimento. */
async function signInAtIdp(page: Page, username: string): Promise<void> {
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#kc-login').click();
}

async function startLogin(page: Page): Promise<URL> {
  const authRequest = page.waitForRequest((r) => r.url().includes('/protocol/openid-connect/auth'));
  await page.getByRole('button', { name: 'Entrar com conta institucional' }).click();
  return new URL((await authRequest).url());
}

test.describe('FR-007: login OIDC no frontend', () => {
  test('FR-007/SC-002: login com editor@olly.local mostra o nome no cabeçalho', async ({
    page,
  }) => {
    await page.goto('/');
    const authUrl = await startLogin(page);
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('code_challenge')).toBeTruthy();

    await signInAtIdp(page, 'editor@olly.local');

    await expect(page.getByTestId('user-name')).toHaveText('Eduardo Editor');
    await expect(page.getByRole('heading', { name: 'Olá, Eduardo Editor' })).toBeVisible();
    await expect(page.getByTestId('projects')).toBeVisible();
    await expect(page).toHaveURL('/');
  });

  test('FR-007: após o login volta para a rota pedida', async ({ page }) => {
    await page.goto('/workflows');
    await startLogin(page);
    await signInAtIdp(page, 'viewer@olly.local');
    await expect(page).toHaveURL('/workflows');
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
    await expect(page.getByTestId('user-name')).toHaveText('Vitor Visualizador');
  });

  test('FR-007: renova o token silenciosamente antes de expirar', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await startLogin(page);
    await signInAtIdp(page, 'executor@olly.local');
    await expect(page.getByTestId('user-name')).toHaveText('Ester Executora');

    const refresh = page.waitForResponse(
      (r) =>
        r.url().endsWith('/protocol/openid-connect/token') &&
        (r.request().postData() ?? '').includes('grant_type=refresh_token'),
    );
    // O access token dura 5 min; o oidc-client-ts renova 1 min antes de expirar.
    await page.clock.fastForward('04:30');
    expect((await refresh).status()).toBe(200);
    await expect(page.getByTestId('user-name')).toHaveText('Ester Executora');
  });

  test('FR-007: logout encerra a sessão no IdP', async ({ page }) => {
    await page.goto('/');
    await startLogin(page);
    await signInAtIdp(page, 'admin@olly.local');
    await expect(page.getByTestId('user-name')).toHaveText('Ana Administradora');

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(
      page.getByRole('button', { name: 'Entrar com conta institucional' }),
    ).toBeVisible();

    // Sem sessão no IdP, um novo login pede credenciais de novo.
    await startLogin(page);
    await expect(page.locator('#username')).toBeVisible();
  });
});
