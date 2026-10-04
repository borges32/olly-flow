import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts'],
    // isolated-vm em Node 20+ recomenda processos sem o snapshot de inicialização.
    pool: 'forks',
    execArgv: ['--no-node-snapshot'],
  },
});
