import { defineConfig } from 'vitest/config';

// Testcontainers (PostgreSQL e Redis): exige Docker.
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Spec 009, SC-008: o teste de exportação mede a memória viva depois de coletar o lixo.
    execArgv: ['--expose-gc'],
  },
});
