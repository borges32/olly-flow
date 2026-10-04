import { defineConfig } from 'vitest/config';

// Testcontainers: exige Docker (PostgreSQL "externo" para os nós, spec 004 plan §9).
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
