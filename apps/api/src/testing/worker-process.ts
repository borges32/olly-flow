/**
 * Worker em processo separado para os testes de resiliência (spec 006, SC-004): o teste o
 * derruba com SIGKILL. A configuração chega em `OLLY_TEST_WORKER_CONFIG` (JSON).
 */
import type { AppConfig } from '../config/config.js';
import { startWorker } from '../worker/worker.js';

const config = JSON.parse(process.env.OLLY_TEST_WORKER_CONFIG ?? '{}') as AppConfig;
const handle = await startWorker(config);
process.send?.({ ready: true, port: handle.port });
