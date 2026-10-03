import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { startTestDatabase, type TestDatabase } from '@olly/db/testing';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { createApp } from '../app.js';
import type { AppConfig } from '../config/config.js';
import { startFakeIssuer, type FakeIssuer } from './fake-oidc-issuer.js';

export const AUDIENCE = 'olly-api';

export interface TestContext {
  app: NestFastifyApplication;
  database: TestDatabase;
  redis: StartedRedisContainer;
  issuer: FakeIssuer;
  config: AppConfig;
  close(): Promise<void>;
}

export async function startTestContext(overrides: Partial<AppConfig> = {}): Promise<TestContext> {
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
    oidc: { issuerUrl: issuer.issuerUrl, audience: AUDIENCE },
    ...overrides,
  };
  const app = await createApp(config);
  return {
    app,
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
