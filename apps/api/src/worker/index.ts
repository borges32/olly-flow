/** Ponto de entrada do worker para `apps/worker` (spec 006). */
export { startWorker, type WorkerHandle } from './worker.js';
export { ConfigError, loadConfig, type AppConfig } from '../config/config.js';
