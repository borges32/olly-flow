import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  OIDC_ISSUER_URL: z.url({ protocol: /^https?$/ }),
  OIDC_AUDIENCE: z.string().min(1),
  // Endereço interno do emissor para descoberta e JWKS, quando difere do `iss` público
  // (ex.: API em container falando com o IdP pela rede do compose).
  OIDC_DISCOVERY_URL: z.url({ protocol: /^https?$/ }).optional(),
  // Grupo do IdP que concede administração global (spec 002). O nome institucional depende
  // da ADR-0005; o padrão é o grupo do IdP de desenvolvimento.
  OIDC_ADMIN_GROUP: z.string().min(1).default('admin'),
  // Spec 003: sandbox de expressões e log de execuções.
  OLLY_EXPRESSION_TIMEOUT_MS: z.coerce.number().int().min(1).max(10_000).default(100),
  OLLY_ISOLATE_MEMORY_MB: z.coerce.number().int().min(8).max(4096).default(128),
  OLLY_NODE_DATA_MAX_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
  OLLY_TIMEZONE: z
    .string()
    .refine(
      (tz) => Intl.supportedValuesOf('timeZone').includes(tz) || tz === 'UTC',
      'fuso horário desconhecido',
    )
    .default('America/Sao_Paulo'),
  // Spec 004: credenciais, HTTP e Postgres.
  OLLY_KEY_PROVIDER: z.enum(['env']).default('env'),
  // Provedor `env`: KEK base64 de 32 bytes. Obrigatória (a API não sobe sem ela).
  OLLY_MASTER_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'deve ser uma chave de 32 bytes em base64',
    ),
  OLLY_HTTP_ALLOWLIST: z.string().default(''),
  OLLY_HTTP_MAX_RESPONSE_MB: z.coerce.number().positive().max(1024).default(50),
  OLLY_PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(5),
  // Object storage dos binários (FR-010). Sem S3_ENDPOINT, respostas binárias falham com aviso.
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).default('olly'),
  // Spec 005: despacho, webhooks e código JS.
  OLLY_MAX_CONCURRENT_EXECUTIONS: z.coerce.number().int().min(1).max(1000).default(10),
  // Em MB e em segundos.
  OLLY_WEBHOOK_MAX_BODY: z.coerce.number().positive().max(1024).default(16),
  OLLY_WEBHOOK_RESPONSE_TIMEOUT: z.coerce.number().positive().max(3600).default(120),
  OLLY_WEBHOOK_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(120),
  OLLY_REQUIRE_WEBHOOK_AUTH: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  OLLY_CODE_TIMEOUT_MS: z.coerce.number().int().min(100).max(600_000).default(30_000),
  OLLY_CODE_MEMORY_MB: z.coerce.number().int().min(16).max(4096).default(128),
  // Atrás de proxy reverso (ex.: nginx do compose): usa X-Forwarded-For como IP do cliente
  // (allowlist de IP do webhook). Só ligue com um proxy confiável na frente.
  OLLY_TRUST_PROXY: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Spec 006: fila, workers, paralelismo, timeout global e cotas. Tempos em segundos.
  OLLY_TEST_RUN_MODE: z.enum(['queue', 'inprocess']).default('queue'),
  OLLY_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(1000).default(20),
  OLLY_WORKER_SHUTDOWN_TIMEOUT: z.coerce.number().positive().max(3600).default(60),
  OLLY_WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(3101),
  OLLY_DEFAULT_WORKFLOW_TIMEOUT: z.coerce.number().positive().max(86_400).default(300),
  OLLY_PROJECT_MAX_CONCURRENT: z.coerce.number().int().min(1).max(10_000).default(20),
  // Lido também pelo motor (`@olly/engine`); validado aqui para falhar cedo.
  OLLY_DEFAULT_MAX_PARALLEL: z.coerce.number().int().min(1).max(1000).default(8),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  logLevel: (typeof LOG_LEVELS)[number];
  port: number;
  host: string;
  trustProxy?: boolean;
  databaseUrl: string;
  redisUrl: string;
  oidc: { issuerUrl: string; discoveryUrl?: string; audience: string; adminGroup: string };
  execution: {
    expressionTimeoutMs: number;
    isolateMemoryMb: number;
    nodeDataMaxBytes: number;
    timezone: string;
    /** Timeout global padrão (`settings.timeoutSec` do workflow prevalece), spec 006 FR-011. */
    workflowTimeoutMs: number;
    /** Paralelismo padrão entre nós (`settings.maxParallel` prevalece). */
    defaultMaxParallel: number;
  };
  credentials: { keyProvider: 'env'; masterKey: string };
  http: { allowlist: string[]; maxResponseBytes: number };
  postgres: { poolMax: number };
  dispatcher: { maxConcurrent: number };
  /** Spec 006: fila de execuções e workers. Tempos em ms. */
  queue: {
    /** Execuções de teste pela fila (padrão) ou no processo da API. Produção é sempre fila. */
    testRunMode: 'queue' | 'inprocess';
    workerConcurrency: number;
    workerShutdownTimeoutMs: number;
    workerPort: number;
    /** Cota padrão de execuções simultâneas por projeto (FR-012). */
    projectMaxConcurrent: number;
    /** Batimento das execuções em andamento (FR-005, plan §2). */
    heartbeatMs: number;
    /** Sem batimento há mais que isto: `worker_lost`. */
    staleAfterMs: number;
    /** Intervalo da varredura de execuções sem batimento. */
    sweepIntervalMs: number;
    /** Espera antes de tentar de novo um job sem vaga na cota do projeto. */
    quotaRetryMs: number;
  };
  webhook: {
    maxBodyBytes: number;
    responseTimeoutMs: number;
    rateLimitPerMin: number;
    requireAuth: boolean;
  };
  code: { timeoutMs: number; memoryMb: number };
  s3?: { endpoint: string; region: string; accessKey: string; secretKey: string; bucket: string };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Configuração inválida:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Valida as variáveis de ambiente na inicialização. A mensagem de erro cita apenas nomes
 * de variáveis, nunca valores, para não vazar segredos em logs.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    port: e.API_PORT,
    host: e.API_HOST,
    trustProxy: e.OLLY_TRUST_PROXY,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    oidc: {
      issuerUrl: e.OIDC_ISSUER_URL.replace(/\/+$/, ''),
      ...(e.OIDC_DISCOVERY_URL && { discoveryUrl: e.OIDC_DISCOVERY_URL.replace(/\/+$/, '') }),
      audience: e.OIDC_AUDIENCE,
      adminGroup: e.OIDC_ADMIN_GROUP,
    },
    execution: {
      expressionTimeoutMs: e.OLLY_EXPRESSION_TIMEOUT_MS,
      isolateMemoryMb: e.OLLY_ISOLATE_MEMORY_MB,
      nodeDataMaxBytes: e.OLLY_NODE_DATA_MAX_BYTES,
      timezone: e.OLLY_TIMEZONE,
      workflowTimeoutMs: Math.floor(e.OLLY_DEFAULT_WORKFLOW_TIMEOUT * 1000),
      defaultMaxParallel: e.OLLY_DEFAULT_MAX_PARALLEL,
    },
    credentials: { keyProvider: e.OLLY_KEY_PROVIDER, masterKey: e.OLLY_MASTER_KEY },
    http: {
      allowlist: e.OLLY_HTTP_ALLOWLIST.split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      maxResponseBytes: Math.floor(e.OLLY_HTTP_MAX_RESPONSE_MB * 1024 * 1024),
    },
    postgres: { poolMax: e.OLLY_PG_POOL_MAX },
    dispatcher: { maxConcurrent: e.OLLY_MAX_CONCURRENT_EXECUTIONS },
    queue: {
      testRunMode: e.OLLY_TEST_RUN_MODE,
      workerConcurrency: e.OLLY_WORKER_CONCURRENCY,
      workerShutdownTimeoutMs: Math.floor(e.OLLY_WORKER_SHUTDOWN_TIMEOUT * 1000),
      workerPort: e.OLLY_WORKER_PORT,
      projectMaxConcurrent: e.OLLY_PROJECT_MAX_CONCURRENT,
      heartbeatMs: 10_000,
      staleAfterMs: 60_000,
      sweepIntervalMs: 60_000,
      quotaRetryMs: 1000,
    },
    webhook: {
      maxBodyBytes: Math.floor(e.OLLY_WEBHOOK_MAX_BODY * 1024 * 1024),
      responseTimeoutMs: Math.floor(e.OLLY_WEBHOOK_RESPONSE_TIMEOUT * 1000),
      rateLimitPerMin: e.OLLY_WEBHOOK_RATE_LIMIT_PER_MIN,
      requireAuth: e.OLLY_REQUIRE_WEBHOOK_AUTH,
    },
    code: { timeoutMs: e.OLLY_CODE_TIMEOUT_MS, memoryMb: e.OLLY_CODE_MEMORY_MB },
    ...(e.S3_ENDPOINT &&
      e.S3_ACCESS_KEY &&
      e.S3_SECRET_KEY && {
        s3: {
          endpoint: e.S3_ENDPOINT,
          region: e.S3_REGION,
          accessKey: e.S3_ACCESS_KEY,
          secretKey: e.S3_SECRET_KEY,
          bucket: e.S3_BUCKET,
        },
      }),
  };
}
