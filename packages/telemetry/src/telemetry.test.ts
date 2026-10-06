import { context, trace } from '@opentelemetry/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activeTraceIds,
  endpointProblems,
  extractTraceContext,
  injectTraceContext,
  ollyMetrics,
  otelLogDestination,
  rateLimitedDiag,
  startTelemetry,
  telemetryEnabled,
  type TelemetryHandle,
} from './index.js';
import { startTestCollector, type TestCollector } from './testing.js';

describe('spec 012 — FR-004: telemetria ligada só com coletor', () => {
  it('FR-004: sem endereço OTLP (ou com OTEL_SDK_DISABLED), fica desligada', () => {
    expect(telemetryEnabled({})).toBe(false);
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: '  ' })).toBe(false);
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318' })).toBe(true);
    expect(
      telemetryEnabled({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://otel:4318/v1/traces' }),
    ).toBe(true);
    expect(
      telemetryEnabled({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318',
        OTEL_SDK_DISABLED: 'true',
      }),
    ).toBe(false);
    expect(startTelemetry({ serviceName: 'x', env: {} }).enabled).toBe(false);
  });

  it('FR-004: endereço sem http(s):// gera aviso claro (o SDK o ignoraria e usaria localhost)', () => {
    expect(endpointProblems({ OTEL_EXPORTER_OTLP_ENDPOINT: '10.194.52.108:4317' })).toEqual([
      'OTEL_EXPORTER_OTLP_ENDPOINT="10.194.52.108:4317" precisa começar com http:// ou https:// (ex.: http://10.194.52.108:4318 para http/protobuf ou http://10.194.52.108:4317 com OTEL_EXPORTER_OTLP_PROTOCOL=grpc)',
    ]);
    expect(endpointProblems({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318' })).toEqual([]);
  });

  it('FR-004: falhas do coletor aparecem no log local no máximo uma vez por minuto', () => {
    const lines: string[] = [];
    let now = 0;
    const logger = rateLimitedDiag(
      (m) => lines.push(m),
      60_000,
      () => now,
    );
    logger.error('Falha ao exportar', new Error('ECONNREFUSED'));
    logger.error('Falha ao exportar', new Error('ECONNREFUSED'));
    now = 61_000;
    logger.error('Falha ao exportar', new Error('ECONNREFUSED'));
    logger.error(JSON.stringify({ message: 'connect ECONNREFUSED 127.0.0.1:4318', stack: 'x' }));
    logger.error(
      JSON.stringify({
        stack: 'AggregateError [ECONNREFUSED]: ...',
        errors: 'Error: connect ECONNREFUSED ::1:4318,Error: connect ECONNREFUSED 127.0.0.1:4318',
        message: '',
      }),
    );
    expect(lines).toEqual([
      '[telemetria] Falha ao exportar: ECONNREFUSED',
      '[telemetria] Falha ao exportar: ECONNREFUSED',
      '[telemetria] Falha ao exportar: connect ECONNREFUSED 127.0.0.1:4318',
      '[telemetria] Falha ao exportar: connect ECONNREFUSED ::1:4318',
    ]);
  });
});

describe('spec 012 — FR-001/FR-002/FR-003: sinais exportados por OTLP', () => {
  let collector: TestCollector;
  let handle: TelemetryHandle;

  beforeAll(async () => {
    collector = await startTestCollector();
    Object.assign(process.env, {
      OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_BSP_SCHEDULE_DELAY: '50',
      OTEL_BLRP_SCHEDULE_DELAY: '50',
      OTEL_METRIC_EXPORT_INTERVAL: '200',
    });
    handle = startTelemetry({ serviceName: 'olly-teste' });
  });
  afterAll(async () => {
    await handle.shutdown();
    await collector.close();
  });

  it('FR-001: o contexto atravessa a fila (traceparent) e os spans chegam ao coletor', async () => {
    const tracer = trace.getTracer('teste');
    const producer = tracer.startSpan('execution.enqueue');
    const carrier = injectTraceContext(trace.setSpan(context.active(), producer));
    producer.end();
    expect(carrier.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const consumer = tracer.startSpan('workflow.execute', {}, extractTraceContext(carrier));
    consumer.end();
    await collector.waitFor(() => collector.spans().length >= 2);
    const [enqueue, execute] = ['execution.enqueue', 'workflow.execute'].map((n) =>
      collector.spans().find((s) => s.name === n),
    );
    expect(execute?.traceId).toBe(enqueue?.traceId);
    expect(execute?.parentSpanId).toBe(enqueue?.spanId);
    expect(execute?.service).toBe('olly-teste');
  });

  it('FR-002: métricas de domínio exportadas', async () => {
    ollyMetrics.execution(
      { status: 'success', trigger: 'manual', mode: 'test', project: 'p' },
      0.2,
    );
    ollyMetrics.node('data.set', 'success', 0.01);
    await collector.waitFor(() =>
      ['olly.executions', 'olly.execution.duration', 'olly.node.duration'].every((n) =>
        collector.metricNames().includes(n),
      ),
    );
  });

  it('FR-003: o log vira registro OTel correlacionado ao trace do span ativo', async () => {
    const span = trace.getTracer('teste').startSpan('com-log');
    const ids = context.with(trace.setSpan(context.active(), span), () => activeTraceIds());
    span.end();
    expect(ids?.trace_id).toBe(span.spanContext().traceId);
    otelLogDestination().write(
      JSON.stringify({ level: 40, time: Date.now(), msg: 'Algo aconteceu', modulo: 'x', ...ids }),
    );
    await collector.waitFor(() => collector.logs().some((l) => l.body === 'Algo aconteceu'));
    const log = collector.logs().find((l) => l.body === 'Algo aconteceu');
    expect(log).toMatchObject({
      severityText: 'WARN',
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      attributes: { modulo: 'x' },
    });
  });
});
