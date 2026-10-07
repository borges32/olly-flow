import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineConfig, devices } from '@playwright/test';

// O ambiente (compose, migrations, seed) é preparado por e2e/prepare.ts antes do Playwright.
const root = fileURLToPath(new URL('../..', import.meta.url));
const envFile = existsSync(`${root}/.env`) ? `${root}/.env` : `${root}/.env.example`;
const env = {
  ...(parseEnv(readFileSync(envFile, 'utf8')) as Record<string, string>),
  ...(process.env as Record<string, string>),
};
const isCI = Boolean(process.env.CI);
// Spec 011: o modelo simulado (credencial `fakeLlm`) só existe com NODE_ENV=test; nada mais
// muda entre `development` e `test` além da documentação Swagger. Os modelos permitidos são
// cadastrados pelos testes (Administração › IA).
const aiEnv = {
  NODE_ENV: 'test',
  // Spec 014: os cenários atuais entram pelo Keycloak; o login local tem cenário próprio.
  OLLY_IDP_ENABLED: 'true',
};

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'pt-BR',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: 'http://localhost:3000/health',
      // Spec 004: o servidor HTTP local dos testes de integração precisa passar no anti-SSRF.
      // Spec 010: o OAuth do servidor MCP de teste usa o Keycloak do compose (localhost:8080).
      env: { ...env, ...aiEnv, LOG_LEVEL: 'warn', OLLY_HTTP_ALLOWLIST: '127.0.0.1,localhost' },
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      // Spec 006: as execuções passam pela fila; o worker executa (mesmo ambiente da API).
      command: 'node ../worker/dist/main.js',
      url: 'http://localhost:3101/health',
      env: { ...env, ...aiEnv, LOG_LEVEL: 'warn', OLLY_HTTP_ALLOWLIST: '127.0.0.1,localhost' },
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      command: 'pnpm exec vite',
      url: 'http://localhost:5173',
      env,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
  ],
});
