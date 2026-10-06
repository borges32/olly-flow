import {
  context,
  isSpanContextValid,
  propagation,
  ROOT_CONTEXT,
  trace,
  type Context,
} from '@opentelemetry/api';

/** Contexto ativo serializado (W3C `traceparent`/`tracestate`) para atravessar a fila. */
export function injectTraceContext(ctx: Context = context.active()): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(ctx, carrier);
  return carrier;
}

/** Contexto a partir do que veio na fila (vazio: o contexto raiz). */
export function extractTraceContext(carrier: Record<string, string> | undefined): Context {
  return carrier ? propagation.extract(ROOT_CONTEXT, carrier) : ROOT_CONTEXT;
}

/** Ids do span ativo para os logs (`undefined` sem telemetria ou fora de um span). */
export function activeTraceIds(): { trace_id: string; span_id: string } | undefined {
  const span = trace.getActiveSpan();
  const sc = span?.spanContext();
  return sc && isSpanContextValid(sc) ? { trace_id: sc.traceId, span_id: sc.spanId } : undefined;
}
