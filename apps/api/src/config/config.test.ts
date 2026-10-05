import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const valid = {
  DATABASE_URL: 'postgres://olly:segredo-do-banco@localhost:5432/olly',
  REDIS_URL: 'redis://localhost:6379',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/olly/',
  OIDC_AUDIENCE: 'olly-api',
  OLLY_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('configuração da API (validação zod na inicialização)', () => {
  it('aplica padrões seguros e normaliza o emissor', () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({
      env: 'production',
      port: 3000,
      logLevel: 'info',
      oidc: { issuerUrl: 'http://localhost:8080/realms/olly', audience: 'olly-api' },
    });
  });

  it('falha na inicialização se faltar variável obrigatória', () => {
    expect(() => loadConfig({ ...valid, OIDC_AUDIENCE: undefined })).toThrow(ConfigError);
  });

  it('rejeita URL com protocolo errado', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: 'mysql://localhost/olly' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('NFR-002: a mensagem de erro não expõe valores das variáveis', () => {
    try {
      loadConfig({ ...valid, API_PORT: 'abc' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/API_PORT/);
      expect(String(error)).not.toMatch(/segredo-do-banco/);
    }
  });

  it('spec 004 — FR-001: a API não sobe sem chave mestra válida, e o erro não mostra a chave', () => {
    expect(() => loadConfig({ ...valid, OLLY_MASTER_KEY: undefined })).toThrow(/OLLY_MASTER_KEY/);
    const short = Buffer.alloc(16, 9).toString('base64');
    try {
      loadConfig({ ...valid, OLLY_MASTER_KEY: short });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/OLLY_MASTER_KEY: deve ser uma chave de 32 bytes/);
      expect(String(error)).not.toContain(short);
    }
  });

  it('spec 005 — NFR-001/NFR-002/FR-003: padrões de webhook, código e concorrência', () => {
    const config = loadConfig(valid);
    expect(config.webhook).toEqual({
      maxBodyBytes: 16 * 1024 * 1024,
      responseTimeoutMs: 120_000,
      rateLimitPerMin: 120,
      requireAuth: false,
    });
    expect(config.code).toEqual({ timeoutMs: 30_000, memoryMb: 128 });
    expect(config.dispatcher.maxConcurrent).toBe(10);
    expect(loadConfig({ ...valid, OLLY_REQUIRE_WEBHOOK_AUTH: 'true' }).webhook.requireAuth).toBe(
      true,
    );
    expect(() => loadConfig({ ...valid, OLLY_REQUIRE_WEBHOOK_AUTH: 'talvez' })).toThrow(
      /OLLY_REQUIRE_WEBHOOK_AUTH/,
    );
  });

  it('spec 004 — FR-008/NFR-001/NFR-002: allowlist, limites e S3 opcional', () => {
    const config = loadConfig({
      ...valid,
      OLLY_HTTP_ALLOWLIST: ' 10.0.0.0/8, api.interna ,',
      OLLY_HTTP_MAX_RESPONSE_MB: '2',
    });
    expect(config.http).toEqual({
      allowlist: ['10.0.0.0/8', 'api.interna'],
      maxResponseBytes: 2 * 1024 * 1024,
    });
    expect(config.postgres.poolMax).toBe(5);
    expect(config.s3).toBeUndefined();
    expect(loadConfig(valid).http).toEqual({ allowlist: [], maxResponseBytes: 50 * 1024 * 1024 });
    const s3 = loadConfig({
      ...valid,
      S3_ENDPOINT: 'http://minio:9000',
      S3_ACCESS_KEY: 'a',
      S3_SECRET_KEY: 'b',
    }).s3;
    expect(s3).toMatchObject({
      endpoint: 'http://minio:9000',
      bucket: 'olly',
      region: 'us-east-1',
    });
  });

  it('spec 006 — FR-004/FR-011/FR-012: padrões de fila, worker, timeout global e cota', () => {
    const config = loadConfig(valid);
    expect(config.queue).toMatchObject({
      testRunMode: 'queue',
      workerConcurrency: 20,
      workerShutdownTimeoutMs: 60_000,
      workerPort: 3101,
      projectMaxConcurrent: 20,
    });
    expect(config.execution.workflowTimeoutMs).toBe(300_000);
    expect(config.execution.defaultMaxParallel).toBe(8);
    const custom = loadConfig({
      ...valid,
      OLLY_TEST_RUN_MODE: 'inprocess',
      OLLY_WORKER_CONCURRENCY: '5',
      OLLY_DEFAULT_WORKFLOW_TIMEOUT: '2.5',
    });
    expect(custom.queue.testRunMode).toBe('inprocess');
    expect(custom.queue.workerConcurrency).toBe(5);
    expect(custom.execution.workflowTimeoutMs).toBe(2500);
    expect(() => loadConfig({ ...valid, OLLY_TEST_RUN_MODE: 'thread' })).toThrow(
      /OLLY_TEST_RUN_MODE/,
    );
    expect(() => loadConfig({ ...valid, OLLY_DEFAULT_MAX_PARALLEL: '0' })).toThrow(
      /OLLY_DEFAULT_MAX_PARALLEL/,
    );
  });
});
