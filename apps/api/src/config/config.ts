import type { VaultOptions } from '@olly/db';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const masterKey = z
  .string()
  .refine(
    (v) => Buffer.from(v, 'base64').length === 32,
    'deve ser uma chave de 32 bytes em base64',
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // Spec 014 (FR-010): login pelo IdP (OIDC) opcional, desligado por padrão. Com ele ligado,
  // OIDC_ISSUER_URL e OIDC_AUDIENCE são obrigatórias.
  OLLY_IDP_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  OIDC_ISSUER_URL: z.url({ protocol: /^https?$/ }).optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),
  // Spec 014 (NFR-004): sessões locais e bloqueio por tentativas erradas.
  OLLY_SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(10_080).default(480),
  OLLY_SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  OLLY_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  OLLY_LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  // Endereço interno do emissor para descoberta e JWKS, quando difere do `iss` público
  // (ex.: API em container falando com o IdP pela rede do compose).
  OIDC_DISCOVERY_URL: z.url({ protocol: /^https?$/ }).optional(),
  // Grupo do IdP que concede administração global (spec 002). O nome institucional depende
  // da ADR-0005; o padrão é o grupo do IdP de desenvolvimento.
  OIDC_ADMIN_GROUP: z.string().min(1).default('admin'),
  // Spec 009 (FR-005): claim com os grupos do usuário no access token.
  OIDC_GROUPS_CLAIM: z.string().min(1).default('groups'),
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
  // Spec 009 (FR-001): `vault` = Vault Transit (ADR-0007, pendente); `env` = desenvolvimento.
  OLLY_KEY_PROVIDER: z.enum(['env', 'vault']).default('env'),
  // Provedor `env`: KEK base64 de 32 bytes, obrigatória. Com `vault`, só enquanto houver
  // credenciais cifradas pelo `env` a migrar (FR-003).
  OLLY_MASTER_KEY: masterKey.optional(),
  OLLY_MASTER_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  // Rotação do `env` (FR-002): chaves anteriores, `versão:base64` separadas por vírgula.
  OLLY_MASTER_KEYS_PREVIOUS: z.string().default(''),
  OLLY_VAULT_ADDR: z.url({ protocol: /^https?$/ }).optional(),
  OLLY_VAULT_AUTH: z.enum(['approle', 'kubernetes']).default('approle'),
  OLLY_VAULT_ROLE_ID: z.string().min(1).optional(),
  OLLY_VAULT_SECRET_ID: z.string().min(1).optional(),
  OLLY_VAULT_K8S_ROLE: z.string().min(1).optional(),
  OLLY_VAULT_TRANSIT_MOUNT: z.string().min(1).default('transit'),
  OLLY_VAULT_TRANSIT_KEY: z.string().min(1).default('olly-credentials'),
  OLLY_VAULT_NAMESPACE: z.string().min(1).optional(),
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
  // Spec 007: teto global de iterações por laço e endereço público (link no workflow de erro).
  OLLY_MAX_LOOP_ITERATIONS: z.coerce.number().int().min(1).max(1_000_000).default(10_000),
  // Spec 008, FR-010: níveis de sub-workflow.
  OLLY_MAX_SUBWORKFLOW_DEPTH: z.coerce.number().int().min(1).max(50).default(5),
  OLLY_PUBLIC_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:5173'),
  // Spec 009: governança e LGPD. Dias e bytes.
  OLLY_USER_INACTIVE_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  OLLY_INLINE_DATA_LIMIT: z.coerce.number().int().min(1024).default(262_144),
  // Salt da ação `hash` do mascaramento, por instalação. Obrigatório em produção.
  OLLY_MASKING_SALT: z.string().min(16).optional(),
  OLLY_RETENTION_DATA_DAYS: z.coerce.number().int().min(1).max(36_500).default(30),
  OLLY_RETENTION_METADATA_DAYS: z.coerce.number().int().min(1).max(36_500).default(365),
  // Job diário de retenção, partições e inativação (cron, no fuso OLLY_TIMEZONE).
  OLLY_MAINTENANCE_CRON: z.string().min(9).default('0 3 * * *'),
  // Spec 010: cliente MCP (timeout por chamada em ms, NFR-001; tamanho máximo do resultado).
  OLLY_MCP_CALL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
  OLLY_MCP_MAX_RESULT_MB: z.coerce.number().positive().max(1024).default(10),
  // Spec 011: AI Agent. Os modelos permitidos são um cadastro na administração (FR-002).
  OLLY_AGENT_MAX_ITERATIONS: z.coerce.number().int().min(1).max(200).default(25),
  OLLY_AGENT_TOOL_RESULT_MAX_CHARS: z.coerce.number().int().min(100).max(1_000_000).default(20_000),
  OLLY_APPROVAL_TIMEOUT_HOURS: z.coerce
    .number()
    .positive()
    .max(24 * 30)
    .default(24),
  OLLY_RETENTION_MEMORY_DAYS: z.coerce.number().int().min(1).max(36_500).default(30),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  logLevel: (typeof LOG_LEVELS)[number];
  port: number;
  host: string;
  trustProxy?: boolean;
  databaseUrl: string;
  redisUrl: string;
  /** Spec 014: autenticação (login local sempre; IdP opcional) e limites das sessões locais. */
  auth: {
    idpEnabled: boolean;
    sessionIdleMs: number;
    sessionMaxMs: number;
    loginMaxAttempts: number;
    loginLockMs: number;
  };
  /** Só com o IdP ligado (`auth.idpEnabled`). */
  oidc?: {
    issuerUrl: string;
    discoveryUrl?: string;
    audience: string;
    adminGroup: string;
    /** Claim de grupos (spec 009, FR-005); padrão `groups`. */
    groupsClaim?: string;
  };
  execution: {
    expressionTimeoutMs: number;
    isolateMemoryMb: number;
    nodeDataMaxBytes: number;
    timezone: string;
    /** Timeout global padrão (`settings.timeoutSec` do workflow prevalece), spec 006 FR-011. */
    workflowTimeoutMs: number;
    /** Paralelismo padrão entre nós (`settings.maxParallel` prevalece). */
    defaultMaxParallel: number;
    /** Teto global de iterações por laço (spec 007, NFR-001). */
    maxLoopIterations: number;
    /** Profundidade máxima de sub-workflows (spec 008, FR-010). */
    maxSubworkflowDepth: number;
  };
  /** Endereço público do Olly Flow (links como `execution.url` do workflow de erro). */
  publicUrl: string;
  credentials: {
    keyProvider: 'env' | 'vault';
    masterKey?: string;
    masterKeyVersion?: number;
    previousMasterKeys?: Record<number, string>;
    vault?: VaultOptions;
  };
  /** Spec 009: governança e LGPD. */
  governance: {
    userInactiveDays: number;
    /** Dados de nó acima disto (bytes de JSON) vão para o object storage (FR-013). */
    inlineDataLimit: number;
    maskingSalt: string;
    retention: { dataDays: number; metadataDays: number };
    maintenanceCron: string;
  };
  http: { allowlist: string[]; maxResponseBytes: number };
  /** Spec 010: cliente MCP. */
  mcp: { callTimeoutMs: number; maxResultBytes: number };
  /** Spec 011: AI Agent. */
  ai: {
    /** Teto global de iterações (NFR-001). */
    maxIterations: number;
    toolResultMaxChars: number;
    /** Prazo das aprovações (NFR-002). */
    approvalTimeoutMs: number;
    /** Retenção padrão da memória persistente (dias). */
    memoryRetentionDays: number;
  };
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
  const issues: string[] = [];
  if (e.OLLY_IDP_ENABLED) {
    if (!e.OIDC_ISSUER_URL) issues.push('OIDC_ISSUER_URL: obrigatória com OLLY_IDP_ENABLED=true');
    if (!e.OIDC_AUDIENCE) issues.push('OIDC_AUDIENCE: obrigatória com OLLY_IDP_ENABLED=true');
  }
  if (e.OLLY_KEY_PROVIDER === 'env' && !e.OLLY_MASTER_KEY) {
    issues.push('OLLY_MASTER_KEY: obrigatória com OLLY_KEY_PROVIDER=env');
  }
  if (e.OLLY_KEY_PROVIDER === 'vault') {
    if (!e.OLLY_VAULT_ADDR) issues.push('OLLY_VAULT_ADDR: obrigatória com OLLY_KEY_PROVIDER=vault');
    if (e.OLLY_VAULT_AUTH === 'approle' && (!e.OLLY_VAULT_ROLE_ID || !e.OLLY_VAULT_SECRET_ID)) {
      issues.push(
        'OLLY_VAULT_ROLE_ID/OLLY_VAULT_SECRET_ID: obrigatórias com OLLY_VAULT_AUTH=approle',
      );
    }
    if (e.OLLY_VAULT_AUTH === 'kubernetes' && !e.OLLY_VAULT_K8S_ROLE) {
      issues.push('OLLY_VAULT_K8S_ROLE: obrigatória com OLLY_VAULT_AUTH=kubernetes');
    }
  }
  if (e.NODE_ENV === 'production' && !e.OLLY_MASKING_SALT) {
    issues.push('OLLY_MASKING_SALT: obrigatório em produção (mínimo 16 caracteres)');
  }
  const previousMasterKeys: Record<number, string> = {};
  for (const entry of e.OLLY_MASTER_KEYS_PREVIOUS.split(',')
    .map((x) => x.trim())
    .filter(Boolean)) {
    const [version, key] = [
      entry.slice(0, entry.indexOf(':')),
      entry.slice(entry.indexOf(':') + 1),
    ];
    if (!/^\d+$/.test(version) || !masterKey.safeParse(key).success) {
      issues.push('OLLY_MASTER_KEYS_PREVIOUS: use versão:base64 (32 bytes), separadas por vírgula');
      break;
    }
    previousMasterKeys[Number(version)] = key;
  }
  if (issues.length > 0) throw new ConfigError(issues);
  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    port: e.API_PORT,
    host: e.API_HOST,
    trustProxy: e.OLLY_TRUST_PROXY,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    auth: {
      idpEnabled: e.OLLY_IDP_ENABLED,
      sessionIdleMs: e.OLLY_SESSION_IDLE_MINUTES * 60_000,
      sessionMaxMs: e.OLLY_SESSION_MAX_HOURS * 3_600_000,
      loginMaxAttempts: e.OLLY_LOGIN_MAX_ATTEMPTS,
      loginLockMs: e.OLLY_LOGIN_LOCK_MINUTES * 60_000,
    },
    ...(e.OLLY_IDP_ENABLED &&
      e.OIDC_ISSUER_URL &&
      e.OIDC_AUDIENCE && {
        oidc: {
          issuerUrl: e.OIDC_ISSUER_URL.replace(/\/+$/, ''),
          ...(e.OIDC_DISCOVERY_URL && {
            discoveryUrl: e.OIDC_DISCOVERY_URL.replace(/\/+$/, ''),
          }),
          audience: e.OIDC_AUDIENCE,
          adminGroup: e.OIDC_ADMIN_GROUP,
          groupsClaim: e.OIDC_GROUPS_CLAIM,
        },
      }),
    execution: {
      expressionTimeoutMs: e.OLLY_EXPRESSION_TIMEOUT_MS,
      isolateMemoryMb: e.OLLY_ISOLATE_MEMORY_MB,
      nodeDataMaxBytes: e.OLLY_NODE_DATA_MAX_BYTES,
      timezone: e.OLLY_TIMEZONE,
      workflowTimeoutMs: Math.floor(e.OLLY_DEFAULT_WORKFLOW_TIMEOUT * 1000),
      defaultMaxParallel: e.OLLY_DEFAULT_MAX_PARALLEL,
      maxLoopIterations: e.OLLY_MAX_LOOP_ITERATIONS,
      maxSubworkflowDepth: e.OLLY_MAX_SUBWORKFLOW_DEPTH,
    },
    publicUrl: e.OLLY_PUBLIC_URL.replace(/\/+$/, ''),
    credentials: {
      keyProvider: e.OLLY_KEY_PROVIDER,
      ...(e.OLLY_MASTER_KEY && { masterKey: e.OLLY_MASTER_KEY }),
      masterKeyVersion: e.OLLY_MASTER_KEY_VERSION,
      previousMasterKeys,
      ...(e.OLLY_VAULT_ADDR && {
        vault: {
          address: e.OLLY_VAULT_ADDR,
          auth: e.OLLY_VAULT_AUTH,
          ...(e.OLLY_VAULT_ROLE_ID && { roleId: e.OLLY_VAULT_ROLE_ID }),
          ...(e.OLLY_VAULT_SECRET_ID && { secretId: e.OLLY_VAULT_SECRET_ID }),
          ...(e.OLLY_VAULT_K8S_ROLE && { kubernetesRole: e.OLLY_VAULT_K8S_ROLE }),
          transitMount: e.OLLY_VAULT_TRANSIT_MOUNT,
          transitKey: e.OLLY_VAULT_TRANSIT_KEY,
          ...(e.OLLY_VAULT_NAMESPACE && { namespace: e.OLLY_VAULT_NAMESPACE }),
        },
      }),
    },
    governance: {
      userInactiveDays: e.OLLY_USER_INACTIVE_DAYS,
      inlineDataLimit: e.OLLY_INLINE_DATA_LIMIT,
      // Fora de produção, um salt fixo de desenvolvimento (hash reproduzível nos testes).
      maskingSalt: e.OLLY_MASKING_SALT ?? 'olly-dev-masking-salt',
      retention: {
        dataDays: e.OLLY_RETENTION_DATA_DAYS,
        metadataDays: e.OLLY_RETENTION_METADATA_DAYS,
      },
      maintenanceCron: e.OLLY_MAINTENANCE_CRON,
    },
    http: {
      allowlist: e.OLLY_HTTP_ALLOWLIST.split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      maxResponseBytes: Math.floor(e.OLLY_HTTP_MAX_RESPONSE_MB * 1024 * 1024),
    },
    mcp: {
      callTimeoutMs: e.OLLY_MCP_CALL_TIMEOUT_MS,
      maxResultBytes: Math.floor(e.OLLY_MCP_MAX_RESULT_MB * 1024 * 1024),
    },
    ai: {
      maxIterations: e.OLLY_AGENT_MAX_ITERATIONS,
      toolResultMaxChars: e.OLLY_AGENT_TOOL_RESULT_MAX_CHARS,
      approvalTimeoutMs: Math.round(e.OLLY_APPROVAL_TIMEOUT_HOURS * 3_600_000),
      memoryRetentionDays: e.OLLY_RETENTION_MEMORY_DAYS,
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
