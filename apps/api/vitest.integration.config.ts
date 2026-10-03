import { defineConfig } from 'vitest/config';

// Testcontainers (PostgreSQL e Redis): exige Docker.
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
