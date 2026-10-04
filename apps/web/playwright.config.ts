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
      env: { ...env, LOG_LEVEL: 'warn', OLLY_HTTP_ALLOWLIST: '127.0.0.1' },
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
