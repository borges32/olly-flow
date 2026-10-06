import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import type { CredentialSummary, ProjectSummary, WorkflowDefinition } from '@olly/shared-types';
import { startTelemetry, type TelemetryHandle } from '@olly/telemetry';
import {
  startTestCollector,
  type CollectedSpan,
  type TestCollector,
} from '@olly/telemetry/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflow, startTestRun, waitForStatus } from '../testing/execution-helpers.js';
import { loginAs, startTestContext, type TestContext, type TestUser } from '../testing/test-app.js';

/** Valores sentinela (SC-003): não podem aparecer em nada enviado ao coletor. */
const S = {
  payload: 'sentinela-payload-7f3a9c',
  token: 'sentinela-token-4b8e2d',
  response: 'sentinela-resposta-1c5f8a',
  cpf: '529.982.247-25',
};

let collector: TestCollector;
let telemetry: TelemetryHandle;
let ctx: TestContext;
let editor: TestUser;
let project: ProjectSummary;
let server: Server;
let base: string;

beforeAll(async () => {
  // API externa usada pelo nó HTTP (com credencial): devolve um valor sentinela.
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ resposta: S.response }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  // Como no `main.ts`: a telemetria inicia antes da aplicação (API e worker no mesmo processo).
  collector = await startTestCollector();
  Object.assign(process.env, {
    OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_BSP_SCHEDULE_DELAY: '50',
    OTEL_BLRP_SCHEDULE_DELAY: '50',
    OTEL_METRIC_EXPORT_INTERVAL: '300',
  });
  telemetry = startTelemetry({ serviceName: 'olly-api' });
  // Logs locais descartados: o que interessa é o que vai ao coletor.
  const quiet = new Writable({
    write(_chunk, _enc, done) {
      done();
    },
  });
  ctx = await startTestContext(
    { logLevel: 'debug', http: { allowlist: ['127.0.0.1'], maxResponseBytes: 1024 * 1024 } },
    { logStream: quiet },
  );
  const admin = await loginAs(ctx, { sub: 'admin', email: 'admin@otel.local', groups: ['admin'] });
  editor = await loginAs(ctx, { sub: 'editor', email: 'editor@otel.local' });
  project = (await admin.call('POST', '/projects', { name: 'Telemetria' })).json<ProjectSummary>();
  await admin.call('PUT', `/projects/${project.id}/members/${editor.id}`, { role: 'editor' });
});
afterAll(async () => {
  await ctx.close();
  await telemetry.shutdown();
  await collector.close();
  server.close();
});

async function webhookWorkflow(path: string): Promise<WorkflowDefinition> {
  const credentialId = (
    await editor.call('POST', `/projects/${project.id}/credentials`, {
      name: `API ${path}`,
      type: 'httpBearer',
      data: { token: S.token },
    })
  ).json<CredentialSummary>().id;
  const at = (x: number): [number, number] => [x, 0];
  return {
    nodes: [
      {
        id: 'w',
        type: 'trigger.webhook',
        name: 'Webhook',
        params: { httpMethod: 'POST', path, responseMode: 'lastNode' },
        position: at(0),
      },
      {
        id: 's',
        type: 'data.set',
        name: 'Campos',
        params: {
          fields: [{ name: 'copia', type: 'string', value: '={{ $json.body.segredo }}' }],
          includeOtherFields: true,
        },
        position: at(200),
      },
      {
        id: 'c',
        type: 'code.javascript',
        name: 'Código',
        params: {
          mode: 'runOnceForAllItems',
          jsCode: 'return $input.all().map((i) => ({ json: { ...i.json, ok: true } }));',
        },
        position: at(400),
      },
      {
        id: 'h',
        type: 'http.request',
        name: 'API',
        params: { url: `${base}/dados`, authentication: 'credential' },
        credentialId,
        position: at(600),
      },
    ],
    edges: [
      { id: 'e1', from: 'w', fromPort: 'main', to: 's', toPort: 'main' },
      { id: 'e2', from: 's', fromPort: 'main', to: 'c', toPort: 'main' },
      { id: 'e3', from: 'c', fromPort: 'main', to: 'h', toPort: 'main' },
    ],
    settings: {},
  };
}

const traceOf = async (executionId: string) =>
  (
    await ctx.database.db
      .selectFrom('executions')
      .select('trace_id')
      .where('id', '=', executionId)
      .executeTakeFirstOrThrow()
  ).trace_id;

describe('spec 012 — HU-1: telemetria OpenTelemetry enviada ao coletor', () => {
  let executionId = '';
  let root: CollectedSpan | undefined;

  it('SC-001/FR-001: webhook → fila → worker gera o trace com span raiz e um span por nó', async () => {
    const wf = await createWorkflow(editor, project.id, await webhookWorkflow('otel'));
    expect(
      (await editor.call('POST', `/workflows/${wf.id}/publish`, { message: 'v1' })).statusCode,
    ).toBe(200);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/webhook/otel',
      payload: { segredo: S.payload, cpf: S.cpf },
    });
    expect(res.statusCode).toBe(200);
    executionId = (
      await ctx.database.db
        .selectFrom('executions')
        .select('id')
        .where('workflow_id', '=', wf.id)
        .executeTakeFirstOrThrow()
    ).id;

    await collector.waitFor(() =>
      collector
        .spans()
        .some(
          (s) => s.name === 'workflow.execute' && s.attributes['olly.execution.id'] === executionId,
        ),
    );
    const spans = collector.spans();
    root = spans.find(
      (s) => s.name === 'workflow.execute' && s.attributes['olly.execution.id'] === executionId,
    );
    expect(root?.attributes).toMatchObject({
      'olly.workflow.id': wf.id,
      'olly.project.id': project.id,
      'olly.trigger.type': 'webhook',
      'olly.execution.mode': 'production',
    });
    // A fila liga o trace da API ao do worker (span producer `execution.enqueue`).
    const enqueue = spans.find((s) => s.spanId === root?.parentSpanId);
    expect(enqueue?.name).toBe('execution.enqueue');
    expect(enqueue?.traceId).toBe(root?.traceId);

    await collector.waitFor(
      () =>
        collector
          .spans()
          .filter((s) => s.parentSpanId === root?.spanId && s.name === 'node.execute').length >= 4,
    );
    const nodes = collector
      .spans()
      .filter((s) => s.parentSpanId === root?.spanId && s.name === 'node.execute');
    expect(nodes.map((n) => n.attributes['olly.node.type']).sort()).toEqual([
      'code.javascript',
      'data.set',
      'http.request',
      'trigger.webhook',
    ]);
    expect(nodes.find((n) => n.attributes['olly.node.id'] === 's')?.attributes).toMatchObject({
      'olly.node.run_index': 0,
      'olly.items.in': 1,
      'olly.items.out': 1,
    });
    // Runners (task-runner): avaliação de expressões e código no mesmo trace.
    await collector.waitFor(() =>
      ['taskrunner.evaluate', 'taskrunner.code'].every((n) =>
        collector.spans().some((s) => s.name === n && s.traceId === root?.traceId),
      ),
    );
    // O id fica na execução, para correlação.
    expect(await traceOf(executionId)).toBe(root?.traceId);
  });

  it('SC-002/FR-002/FR-003: métricas e logs correlacionados chegam ao coletor por OTLP', async () => {
    await collector.waitFor(() =>
      [
        'olly.executions',
        'olly.execution.duration',
        'olly.node.duration',
        'olly.webhook.requests',
        'olly.queue.waiting',
        'olly.queue.active',
      ].every((n) => collector.metricNames().includes(n)),
    );
    await collector.waitFor(() => collector.logs().some((l) => l.traceId === root?.traceId));
    const log = collector.logs().find((l) => l.traceId === root?.traceId);
    expect(log?.service).toBe('olly-api');
  });

  it('SC-003/FR-003: nada de payload ou segredo no que foi enviado; logs mascarados', async () => {
    // Uma linha de log com CPF (a URL da requisição) vai ao coletor já mascarada.
    await editor.call(
      'GET',
      `/projects/${project.id}/workflows?busca=${encodeURIComponent(S.cpf)}`,
    );
    await collector.waitFor(() => collector.raw().includes('***.***.247-**'));
    const raw = collector.raw();
    for (const value of Object.values(S)) expect(raw, value).not.toContain(value);
  });

  it('SC-006/FR-004/NFR-001: com o coletor fora do ar, a execução segue normal', async () => {
    await collector.close();
    const definition: WorkflowDefinition = {
      nodes: [
        { id: 'm', type: 'trigger.manual', name: 'Início', params: {}, position: [0, 0] },
        {
          id: 's',
          type: 'data.set',
          name: 'Campos',
          params: { fields: [{ name: 'x', type: 'number', value: '1' }] },
          position: [200, 0],
        },
      ],
      edges: [{ id: 'e', from: 'm', fromPort: 'main', to: 's', toPort: 'main' }],
      settings: {},
    };
    const wf = await createWorkflow(editor, project.id, definition);
    const started = Date.now();
    const detail = await waitForStatus(editor, await startTestRun(editor, wf));
    expect(detail.status).toBe('success');
    // A exportação é assíncrona: a falha do coletor não entra no caminho da execução.
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
