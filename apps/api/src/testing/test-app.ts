import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MeResponse } from '@olly/shared-types';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@olly/db/testing';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { createApp } from '../app.js';
import type { AppOptions } from '../app.module.js';
import type { AppConfig } from '../config/config.js';
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
  close(): Promise<void>;
}

export async function startTestContext(
  overrides: Partial<AppConfig> = {},
  options: AppOptions = {},
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
    oidc: { issuerUrl: issuer.issuerUrl, audience: AUDIENCE, adminGroup: 'admin' },
    execution: {
      // Folgado: com testes em paralelo, CPU disputada não pode virar timeout de expressão.
      expressionTimeoutMs: 1000,
      isolateMemoryMb: 64,
      nodeDataMaxBytes: 1_048_576,
      timezone: 'UTC',
    },
    credentials: { keyProvider: 'env', masterKey: randomBytes(32).toString('base64') },
    http: { allowlist: [], maxResponseBytes: 50 * 1024 * 1024 },
    postgres: { poolMax: 5 },
    dispatcher: { maxConcurrent: 10 },
    webhook: {
      maxBodyBytes: 16 * 1024 * 1024,
      responseTimeoutMs: 120_000,
      rateLimitPerMin: 120,
      requireAuth: false,
    },
    code: { timeoutMs: 30_000, memoryMb: 128 },
    ...overrides,
  };
  const app = await createApp(config, options);
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
    close: async () => {
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
