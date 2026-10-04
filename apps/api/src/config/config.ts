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
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  logLevel: (typeof LOG_LEVELS)[number];
  port: number;
  host: string;
  databaseUrl: string;
  redisUrl: string;
  oidc: { issuerUrl: string; discoveryUrl?: string; audience: string; adminGroup: string };
  execution: {
    expressionTimeoutMs: number;
    isolateMemoryMb: number;
    nodeDataMaxBytes: number;
    timezone: string;
  };
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
    },
  };
}
