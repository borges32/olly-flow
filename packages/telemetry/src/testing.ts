import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';

type OtlpValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: OtlpValue[] };
  kvlistValue?: { values?: OtlpKeyValue[] };
};
type OtlpKeyValue = { key: string; value?: OtlpValue };

export interface CollectedSpan {
  service: string;
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  kind: number;
  status: { code?: number; message?: string };
  attributes: Record<string, unknown>;
}

export interface CollectedLog {
  service: string;
  body: unknown;
  severityText: string;
  traceId: string;
  spanId: string;
  attributes: Record<string, unknown>;
}

function value(v: OtlpValue | undefined): unknown {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(value);
  if (v.kvlistValue) return attributes(v.kvlistValue.values);
  return undefined;
}

function attributes(list: OtlpKeyValue[] | undefined): Record<string, unknown> {
  return Object.fromEntries((list ?? []).map((kv) => [kv.key, value(kv.value)]));
}

/** OTLP/JSON codifica os ids em hexadecimal; alguns emissores usam base64. */
function hexId(id: unknown): string {
  if (typeof id !== 'string' || id === '') return '';
  if (/^[0-9a-f]+$/.test(id)) return id;
  return Buffer.from(id, 'base64').toString('hex');
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  return (req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString('utf8');
}

interface Resource {
  resource?: { attributes?: OtlpKeyValue[] };
}

export interface TestCollector {
  /** Base para `OTEL_EXPORTER_OTLP_ENDPOINT`. */
  url: string;
  spans(): CollectedSpan[];
  metricNames(): string[];
  logs(): CollectedLog[];
  /** Tudo o que chegou, em texto (busca de valores sentinela). */
  raw(): string;
  /** Espera até a condição valer (as exportações são em lote). */
  waitFor(condition: () => boolean, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * Coletor OTLP/HTTP (JSON) em processo para os testes (spec 012, plan §1): guarda o que recebe em
 * `/v1/traces`, `/v1/metrics` e `/v1/logs`. Use `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`.
 */
export async function startTestCollector(): Promise<TestCollector> {
  const received: { path: string; payload: Record<string, unknown> }[] = [];
  const texts: string[] = [];
  const server = createServer((req, res) => {
    void body(req).then(
      (text) => {
        texts.push(text);
        try {
          received.push({
            path: req.url ?? '',
            payload: JSON.parse(text) as Record<string, unknown>,
          });
        } catch {
          // Corpo não-JSON (ex.: protobuf): só o texto fica para a busca.
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      },
      () => res.writeHead(400).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const service = (r: Resource) => text(attributes(r.resource?.attributes)['service.name']);
  const of = (suffix: string) =>
    received.filter((r) => r.path.endsWith(suffix)).map((r) => r.payload);

  return {
    url: `http://127.0.0.1:${String(port)}`,
    spans: () =>
      of('/v1/traces').flatMap((p) =>
        (
          (p.resourceSpans ?? []) as (Resource & {
            scopeSpans?: { spans?: Record<string, unknown>[] }[];
          })[]
        ).flatMap((rs) =>
          (rs.scopeSpans ?? []).flatMap((ss) =>
            (ss.spans ?? []).map((s): CollectedSpan => ({
              service: service(rs),
              name: String(s.name),
              traceId: hexId(s.traceId),
              spanId: hexId(s.spanId),
              parentSpanId: hexId(s.parentSpanId),
              kind: Number(s.kind ?? 0),
              status: s.status ?? {},
              attributes: attributes(s.attributes as OtlpKeyValue[] | undefined),
            })),
          ),
        ),
      ),
    metricNames: () => [
      ...new Set(
        of('/v1/metrics').flatMap((p) =>
          (
            (p.resourceMetrics ?? []) as { scopeMetrics?: { metrics?: { name: string }[] }[] }[]
          ).flatMap((rm) =>
            (rm.scopeMetrics ?? []).flatMap((sm) => (sm.metrics ?? []).map((m) => m.name)),
          ),
        ),
      ),
    ],
    logs: () =>
      of('/v1/logs').flatMap((p) =>
        (
          (p.resourceLogs ?? []) as (Resource & {
            scopeLogs?: { logRecords?: Record<string, unknown>[] }[];
          })[]
        ).flatMap((rl) =>
          (rl.scopeLogs ?? []).flatMap((sl) =>
            (sl.logRecords ?? []).map((l): CollectedLog => ({
              service: service(rl),
              body: value(l.body as OtlpValue | undefined),
              severityText: text(l.severityText),
              traceId: hexId(l.traceId),
              spanId: hexId(l.spanId),
              attributes: attributes(l.attributes as OtlpKeyValue[] | undefined),
            })),
          ),
        ),
      ),
    raw: () => texts.join('\n'),
    waitFor: async (condition, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      while (!condition()) {
        if (Date.now() > deadline)
          throw new Error('Telemetria esperada não chegou ao coletor de teste');
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
