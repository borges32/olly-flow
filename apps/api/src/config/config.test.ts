import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const valid = {
  DATABASE_URL: 'postgres://olly:segredo-do-banco@localhost:5432/olly',
  REDIS_URL: 'redis://localhost:6379',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/olly/',
  OIDC_AUDIENCE: 'olly-api',
  OLLY_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
  OLLY_MASKING_SALT: 'salt-de-producao-0123456789',
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

  it('spec 007 — NFR-001/FR-014: teto global de iterações e endereço público', () => {
    const config = loadConfig(valid);
    expect(config.execution.maxLoopIterations).toBe(10_000);
    expect(config.publicUrl).toBe('http://localhost:5173');
    const custom = loadConfig({
      ...valid,
      OLLY_MAX_LOOP_ITERATIONS: '50',
      OLLY_PUBLIC_URL: 'https://olly.interno/',
    });
    expect(custom.execution.maxLoopIterations).toBe(50);
    expect(custom.publicUrl).toBe('https://olly.interno');
    expect(() => loadConfig({ ...valid, OLLY_MAX_LOOP_ITERATIONS: '0' })).toThrow(
      /OLLY_MAX_LOOP_ITERATIONS/,
    );
  });

  it('spec 009 — FR-001/FR-005/FR-013/FR-017: cofre, grupos, dados e retenção', () => {
    const config = loadConfig(valid);
    expect(config.credentials.keyProvider).toBe('env');
    expect(config.oidc.groupsClaim).toBe('groups');
    expect(config.governance).toMatchObject({
      userInactiveDays: 90,
      inlineDataLimit: 262_144,
      retention: { dataDays: 30, metadataDays: 365 },
      maintenanceCron: '0 3 * * *',
    });
    // FR-001: Vault selecionado por configuração, autenticado por AppRole (sem token fixo).
    const vault = loadConfig({
      ...valid,
      OLLY_MASTER_KEY: undefined,
      OLLY_KEY_PROVIDER: 'vault',
      OLLY_VAULT_ADDR: 'http://vault:8200',
      OLLY_VAULT_ROLE_ID: 'role',
      OLLY_VAULT_SECRET_ID: 'secret',
    });
    expect(vault.credentials).toMatchObject({
      keyProvider: 'vault',
      vault: { address: 'http://vault:8200', auth: 'approle', transitKey: 'olly-credentials' },
    });
    expect(() =>
      loadConfig({ ...valid, OLLY_KEY_PROVIDER: 'vault', OLLY_VAULT_ADDR: 'http://vault:8200' }),
    ).toThrow(/OLLY_VAULT_ROLE_ID/);
    expect(() => loadConfig({ ...valid, OLLY_MASTER_KEY: undefined })).toThrow(/OLLY_MASTER_KEY/);
    // FR-002: chaves anteriores para a rotação do provedor `env`.
    const rotated = loadConfig({
      ...valid,
      OLLY_MASTER_KEY_VERSION: '2',
      OLLY_MASTER_KEYS_PREVIOUS: `1:${Buffer.alloc(32, 1).toString('base64')}`,
    });
    expect(rotated.credentials.masterKeyVersion).toBe(2);
    expect(Object.keys(rotated.credentials.previousMasterKeys ?? {})).toEqual(['1']);
    expect(() => loadConfig({ ...valid, OLLY_MASTER_KEYS_PREVIOUS: 'x' })).toThrow(
      /OLLY_MASTER_KEYS_PREVIOUS/,
    );
    // FR-014: salt do hash obrigatório em produção.
    expect(() => loadConfig({ ...valid, OLLY_MASKING_SALT: undefined })).toThrow(
      /OLLY_MASKING_SALT/,
    );
    expect(
      loadConfig({ ...valid, NODE_ENV: 'development', OLLY_MASKING_SALT: undefined }).governance
        .maskingSalt,
    ).toBeTruthy();
  });
  it('spec 010 — NFR-001/FR-006: timeout de 60 s por chamada MCP e limite do resultado', () => {
    const config = loadConfig(valid);
    expect(config.mcp).toEqual({ callTimeoutMs: 60_000, maxResultBytes: 10 * 1024 * 1024 });
    const custom = loadConfig({
      ...valid,
      OLLY_MCP_CALL_TIMEOUT_MS: '5000',
      OLLY_MCP_MAX_RESULT_MB: '1',
    });
    expect(custom.mcp).toEqual({ callTimeoutMs: 5000, maxResultBytes: 1024 * 1024 });
    expect(() => loadConfig({ ...valid, OLLY_MCP_CALL_TIMEOUT_MS: '10' })).toThrow(
      /OLLY_MCP_CALL_TIMEOUT_MS/,
    );
  });
  it('spec 011 — NFR-001/NFR-002/FR-002: limites do agente; modelos não vêm do ambiente', () => {
    const config = loadConfig(valid);
    expect(config.ai).toEqual({
      maxIterations: 25,
      toolResultMaxChars: 20_000,
      approvalTimeoutMs: 24 * 3_600_000,
      memoryRetentionDays: 30,
    });
    const custom = loadConfig({
      ...valid,
      // FR-002: a lista é um cadastro na administração; a variável antiga é ignorada.
      OLLY_ALLOWED_MODELS: 'gpt-4o-mini, claude-sonnet-5-5',
      OLLY_APPROVAL_TIMEOUT_HOURS: '1',
    });
    expect(custom.ai).not.toHaveProperty('allowedModels');
    expect(custom.ai.approvalTimeoutMs).toBe(3_600_000);
  });
});
