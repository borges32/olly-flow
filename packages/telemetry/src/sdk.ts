import { diag, DiagLogLevel, type DiagLogger } from '@opentelemetry/api';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/** Endereços OTLP (geral ou por sinal) que ligam a telemetria (spec 012, FR-004). */
const ENDPOINT_VARS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
] as const;

/** Telemetria ligada: há endereço OTLP e `OTEL_SDK_DISABLED` não é `true`. */
export function telemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === 'true') return false;
  return ENDPOINT_VARS.some((name) => Boolean(env[name]?.trim()));
}

export interface TelemetryHandle {
  readonly enabled: boolean;
  /** Envia o que estiver pendente e encerra (chamar ao desligar o processo). */
  shutdown(): Promise<void>;
}

/** O OTel às vezes entrega o erro como JSON (com a pilha): fica só a mensagem. */
function readable(message: string): string {
  if (!message.startsWith('{')) return message;
  try {
    const parsed = JSON.parse(message) as { message?: unknown };
    return typeof parsed.message === 'string' ? `Falha ao exportar: ${parsed.message}` : message;
  } catch {
    return message;
  }
}

/** Falhas do exportador no log local, no máximo uma por minuto por mensagem (coletor fora). */
export function rateLimitedDiag(
  write: (message: string) => void,
  intervalMs = 60_000,
  now: () => number = Date.now,
): DiagLogger {
  const last = new Map<string, number>();
  const log = (raw: string, ...args: unknown[]) => {
    const message = readable(raw);
    const key = message.slice(0, 80);
    const at = now();
    if ((last.get(key) ?? -Infinity) + intervalMs > at) return;
    last.set(key, at);
    const detail = args
      .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : ''))
      .filter(Boolean)
      .join(' ');
    write(`[telemetria] ${message}${detail ? `: ${detail}` : ''}`);
  };
  const ignore = () => undefined;
  return { error: log, warn: log, info: ignore, debug: ignore, verbose: ignore };
}

/**
 * Inicia o SDK OpenTelemetry (spec 012, plan §1) com as variáveis padrão (`OTEL_EXPORTER_OTLP_*`,
 * protocolo, cabeçalhos, filas, amostragem): traces, métricas e logs vão por OTLP ao coletor.
 * Sem endereço, não inicia nada. Chamar antes de carregar o Fastify (instrumentação `http`).
 */
export function startTelemetry(options: {
  serviceName: string;
  /** Spans de servidor das requisições HTTP (API e webhooks). */
  instrumentHttp?: boolean;
  /** Caminhos sem span (verificação de saúde). */
  ignorePaths?: string[];
  env?: NodeJS.ProcessEnv;
}): TelemetryHandle {
  const env = options.env ?? process.env;
  if (!telemetryEnabled(env)) return { enabled: false, shutdown: () => Promise.resolve() };
  diag.setLogger(
    rateLimitedDiag((m) => {
      console.warn(m);
    }),
    DiagLogLevel.WARN,
  );
  const ignored = new Set(options.ignorePaths ?? ['/health']);
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME?.trim() || options.serviceName,
    }),
    instrumentations: options.instrumentHttp
      ? [
          new HttpInstrumentation({
            ignoreIncomingRequestHook: (req) => ignored.has((req.url ?? '').split('?')[0] ?? ''),
            // Chamadas de saída (coletor, provedores) não viram spans de cliente aqui.
            ignoreOutgoingRequestHook: () => true,
          }),
        ]
      : [],
  });
  sdk.start();
  let stopped: Promise<void> | undefined;
  return {
    enabled: true,
    shutdown: () => (stopped ??= sdk.shutdown().catch(() => undefined)),
  };
}
