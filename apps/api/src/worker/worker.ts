import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import type { AppOptions } from '../app.module.js';
import type { AppConfig } from '../config/config.js';
import { MaintenanceScheduler } from '../maintenance/maintenance.scheduler.js';
import { ExecutionProcessor, type WorkerStats } from './execution-processor.js';
import { WorkerModule } from './worker.module.js';

export interface WorkerHandle {
  /** Porta do servidor de saúde/métricas. */
  port: number;
  stats(): WorkerStats;
  /** Encerramento gracioso (FR-004); `timeoutMs` padrão: `OLLY_WORKER_SHUTDOWN_TIMEOUT`. */
  close(timeoutMs?: number): Promise<void>;
}

/** Métricas no formato texto do Prometheus (NFR-002). */
function metrics(stats: WorkerStats): string {
  const lines = [
    ['olly_worker_concurrency', 'gauge', 'Jobs simultâneos permitidos', stats.concurrency],
    ['olly_worker_active_executions', 'gauge', 'Execuções em andamento', stats.active],
    ['olly_worker_executions_succeeded_total', 'counter', 'Execuções com sucesso', stats.processed],
    [
      'olly_worker_executions_failed_total',
      'counter',
      'Execuções com erro ou canceladas',
      stats.failed,
    ],
    [
      'olly_worker_quota_delays_total',
      'counter',
      'Jobs adiados pela cota do projeto',
      stats.delayedByQuota,
    ],
    ['process_resident_memory_bytes', 'gauge', 'Memória residente', process.memoryUsage().rss],
  ] as const;
  return `${lines
    .map(
      ([name, type, help, value]) =>
        `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}`,
    )
    .join('\n')}\n`;
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/**
 * Sobe um worker (spec 006, plan §2): contexto NestJS sem HTTP da API + servidor mínimo com
 * `/health` e `/metrics` na porta interna `OLLY_WORKER_PORT`.
 */
export async function startWorker(
  config: AppConfig,
  options: AppOptions = {},
): Promise<WorkerHandle> {
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config, options), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const processor = app.get(ExecutionProcessor);
  await processor.start();
  const maintenance = app.get(MaintenanceScheduler);
  await maintenance.start();

  const server = createServer((req, res) => {
    const stats = processor.stats;
    if (req.url === '/health') {
      res.writeHead(stats.shuttingDown ? 503 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: stats.shuttingDown ? 'shutting_down' : 'ok', ...stats }));
      return;
    }
    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      res.end(metrics(stats));
      return;
    }
    res.writeHead(404).end();
  });
  const port = await listen(server, config.queue.workerPort, config.host);

  let closing: Promise<void> | undefined;
  return {
    port,
    stats: () => processor.stats,
    close: (timeoutMs) =>
      (closing ??= (async () => {
        await processor.close(timeoutMs);
        await maintenance.close();
        await new Promise((resolve) => server.close(resolve));
        await app.close();
      })()),
  };
}
