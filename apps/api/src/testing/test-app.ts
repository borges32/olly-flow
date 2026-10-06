import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MeResponse } from '@olly/shared-types';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@olly/db/testing';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { createApp } from '../app.js';
import type { AppOptions } from '../app.module.js';
import type { AppConfig } from '../config/config.js';
import { startWorker, type WorkerHandle } from '../worker/worker.js';
import { startFakeIssuer, type FakeIssuer } from './fake-oidc-issuer.js';

export const AUDIENCE = 'olly-api';

export interface TestContext {
  app: NestFastifyApplication;
  /** Sobe o servidor HTTP numa porta livre (necessário para WebSocket) e devolve a URL. */
  listen(): Promise<string>;
  database: TestDatabase;
  redis: StartedRedisContainer;
  issuer: FakeIssuer;
  config: AppConfig;
  /** Worker no mesmo processo (spec 006), salvo com `{ worker: false }`. */
  worker?: WorkerHandle;
  /** Sobe mais um worker com a mesma configuração (ou com ajustes). */
  startWorker(overrides?: Partial<AppConfig>): Promise<WorkerHandle>;
  close(): Promise<void>;
}

export interface TestContextOptions extends AppOptions {
  /** Padrão `true`: as execuções passam pela fila e por um worker (spec 006). */
  worker?: boolean;
}

export async function startTestContext(
  overrides: Partial<AppConfig> = {},
  options: TestContextOptions = {},
): Promise<TestContext> {
  const [database, redis, issuer] = await Promise.all([
    startTestDatabase(),
    new RedisContainer('redis:7-alpine').start(),
    startFakeIssuer(AUDIENCE),
  ]);
  const config: AppConfig = {
    env: 'test',
    logLevel: 'silent',
    port: 0,
    host: '127.0.0.1',
    databaseUrl: database.connectionString,
    redisUrl: redis.getConnectionUrl(),
    execution: {
      // Folgado: com testes em paralelo, CPU disputada não pode virar timeout de expressão.
      expressionTimeoutMs: 1000,
      isolateMemoryMb: 64,
      nodeDataMaxBytes: 1_048_576,
      timezone: 'UTC',
      workflowTimeoutMs: 300_000,
      // Regressão do plan §3: OLLY_DEFAULT_MAX_PARALLEL=1 roda a suíte em modo sequencial.
      defaultMaxParallel: Number(process.env.OLLY_DEFAULT_MAX_PARALLEL) || 8,
      maxLoopIterations: 10_000,
    },
    publicUrl: 'http://localhost:5173',
    credentials: { keyProvider: 'env', masterKey: randomBytes(32).toString('base64') },
    governance: {
      userInactiveDays: 90,
      inlineDataLimit: 262_144,
      maskingSalt: 'salt-de-teste-0123456789',
      retention: { dataDays: 30, metadataDays: 365 },
      maintenanceCron: '0 3 * * *',
    },
    http: { allowlist: [], maxResponseBytes: 50 * 1024 * 1024 },
    mcp: { callTimeoutMs: 60_000, maxResultBytes: 10 * 1024 * 1024 },
    postgres: { poolMax: 5 },
    dispatcher: { maxConcurrent: 10 },
    queue: {
      testRunMode: 'queue',
      workerConcurrency: 10,
      workerShutdownTimeoutMs: 5000,
      workerPort: 0,
      projectMaxConcurrent: 20,
      heartbeatMs: 10_000,
      staleAfterMs: 60_000,
      sweepIntervalMs: 60_000,
      quotaRetryMs: 200,
    },
    webhook: {
      maxBodyBytes: 16 * 1024 * 1024,
      responseTimeoutMs: 120_000,
      rateLimitPerMin: 120,
      requireAuth: false,
    },
    code: { timeoutMs: 30_000, memoryMb: 128 },
    ...overrides,
    // Sobrescrita parcial do OIDC (ex.: claim de grupos, spec 009): o emissor é o do teste.
    oidc: {
      issuerUrl: issuer.issuerUrl,
      audience: AUDIENCE,
      adminGroup: 'admin',
      ...overrides.oidc,
    },
  };
  const app = await createApp(config, options);
  const workers: WorkerHandle[] = [];
  const spawn = async (extra: Partial<AppConfig> = {}) => {
    const worker = await startWorker({ ...config, ...extra }, options);
    workers.push(worker);
    return worker;
  };
  const worker = options.worker === false ? undefined : await spawn();
  let url: string | undefined;
  return {
    app,
    listen: async () => {
      if (!url) {
        await app.listen(0, '127.0.0.1');
        url = await app.getUrl();
      }
      return url.replace('[::1]', '127.0.0.1');
    },
    database,
    redis,
    issuer,
    config,
    ...(worker && { worker }),
    startWorker: spawn,
    close: async () => {
      await Promise.allSettled(workers.map((w) => w.close(1000)));
      await app.close();
      // allSettled: alguns testes derrubam dependências de propósito antes do fim.
      await Promise.allSettled([database.stop(), redis.stop(), issuer.close()]);
    },
  };
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  /** Chama a API (prefixo /api/v1) autenticado como este usuário. */
  call(
    method: InjectOptions['method'],
    path: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse>;
}

/** Autentica um usuário no IdP falso e sincroniza-o na plataforma (via /me). */
export async function loginAs(
  ctx: TestContext,
  claims: { sub: string; email: string; name?: string; groups?: string[] },
): Promise<TestUser> {
  const token = await ctx.issuer.sign(claims);
  const call: TestUser['call'] = (method, path, payload) =>
    ctx.app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload !== undefined && { payload: payload as InjectOptions['payload'] }),
    });
  const me = await call('GET', '/me');
  if (me.statusCode !== 200) throw new Error(`login falhou: ${me.statusCode} ${me.body}`);
  return { id: me.json<MeResponse>().id, email: claims.email, token, call };
}
