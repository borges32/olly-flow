import { defineConfig } from 'vitest/config';

// Testcontainers: exige Docker. Cada arquivo sobe seu próprio PostgreSQL.
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
