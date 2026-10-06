import { ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api';
import { logs, SeverityNumber, type AnyValueMap } from '@opentelemetry/api-logs';

/** Níveis do pino → severidade OTel. */
const SEVERITY: Record<number, { number: SeverityNumber; text: string }> = {
  10: { number: SeverityNumber.TRACE, text: 'TRACE' },
  20: { number: SeverityNumber.DEBUG, text: 'DEBUG' },
  30: { number: SeverityNumber.INFO, text: 'INFO' },
  40: { number: SeverityNumber.WARN, text: 'WARN' },
  50: { number: SeverityNumber.ERROR, text: 'ERROR' },
  60: { number: SeverityNumber.FATAL, text: 'FATAL' },
};

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;

/**
 * Destino do pino que envia cada linha como registro de log OTel (spec 012, FR-003, plan §4).
 * Recebe a linha já serializada, portanto já mascarada (spec 009); os ids do trace vêm nos
 * campos `trace_id`/`span_id` e correlacionam o registro.
 */
export function otelLogDestination(): { write(line: string): void } {
  return {
    write(line: string) {
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      const { level, time, msg, trace_id: traceId, span_id: spanId, ...rest } = record;
      const severity = SEVERITY[typeof level === 'number' ? level : 30] ?? SEVERITY[30];
      const correlated =
        typeof traceId === 'string' &&
        typeof spanId === 'string' &&
        HEX32.test(traceId) &&
        HEX16.test(spanId)
          ? trace.setSpanContext(ROOT_CONTEXT, { traceId, spanId, traceFlags: TraceFlags.SAMPLED })
          : undefined;
      logs.getLogger('olly-flow').emit({
        ...(severity && { severityNumber: severity.number, severityText: severity.text }),
        body: typeof msg === 'string' ? msg : '',
        attributes: rest as AnyValueMap,
        ...(typeof time === 'number' && { timestamp: time }),
        ...(correlated && { context: correlated }),
      });
    },
  };
}
