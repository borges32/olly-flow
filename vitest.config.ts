import { defineConfig } from 'vitest/config';

// Testes de nível de repositório (estrutura, realm, fixtures, CI). Os testes de cada
// workspace rodam via `turbo run test`.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
