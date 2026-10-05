import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig, startWorker } from '@olly/api/worker';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

try {
  const config = loadConfig(process.env);
  const worker = await startWorker(config);
  let stopping = false;
  // Spec 006, FR-004: no SIGTERM, para de consumir e espera as execuções em andamento.
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.info(
      `${signal} recebido: encerrando o worker (até ${String(config.queue.workerShutdownTimeoutMs)} ms)`,
    );
    worker.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', () => {
    stop('SIGTERM');
  });
  process.on('SIGINT', () => {
    stop('SIGINT');
  });
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
