import { metrics, type Counter, type Histogram } from '@opentelemetry/api';

/** Métricas de domínio (spec 012, FR-002, plan §3): sem ids de workflow ou execução. */
interface Instruments {
  executions: Counter;
  executionDuration: Histogram;
  nodeDuration: Histogram;
  webhookRequests: Counter;
  sandboxErrors: Counter;
  llmTokens: Counter;
  mcpCalls: Counter;
}

let instruments: Instruments | undefined;

/** Criados no primeiro uso, depois de o SDK registrar o provedor (sem SDK: no-op). */
function get(): Instruments {
  if (instruments) return instruments;
  const meter = metrics.getMeter('olly-flow');
  instruments = {
    executions: meter.createCounter('olly.executions', {
      description: 'Execuções de workflow terminadas',
    }),
    executionDuration: meter.createHistogram('olly.execution.duration', {
      description: 'Duração das execuções de workflow',
      unit: 's',
    }),
    nodeDuration: meter.createHistogram('olly.node.duration', {
      description: 'Duração da execução de cada nó',
      unit: 's',
    }),
    webhookRequests: meter.createCounter('olly.webhook.requests', {
      description: 'Requisições recebidas pelos webhooks',
    }),
    sandboxErrors: meter.createCounter('olly.sandbox.errors', {
      description: 'Falhas do sandbox de código e expressões',
    }),
    llmTokens: meter.createCounter('olly.llm.tokens', {
      description: 'Tokens de modelos de linguagem',
      unit: '{token}',
    }),
    mcpCalls: meter.createCounter('olly.mcp.calls', { description: 'Chamadas a servidores MCP' }),
  };
  return instruments;
}

export const ollyMetrics = {
  execution(
    attrs: { status: string; trigger: string; mode: string; project: string },
    seconds: number,
  ): void {
    get().executions.add(1, attrs);
    get().executionDuration.record(seconds, {
      status: attrs.status,
      trigger: attrs.trigger,
      mode: attrs.mode,
    });
  },
  node(nodeType: string, status: string, seconds: number): void {
    get().nodeDuration.record(seconds, { node_type: nodeType, status });
  },
  webhookRequest(status: number): void {
    get().webhookRequests.add(1, { status: String(status) });
  },
  sandboxError(runtime: string, reason: string): void {
    get().sandboxErrors.add(1, { runtime, reason });
  },
  llmTokens(model: string, input: number, output: number): void {
    if (input > 0) get().llmTokens.add(input, { model, direction: 'input' });
    if (output > 0) get().llmTokens.add(output, { model, direction: 'output' });
  },
  mcpCall(server: string, status: string): void {
    get().mcpCalls.add(1, { server, status });
  },
  /** Tamanho da fila (*gauges* observáveis), lido a cada coleta. */
  observeQueue(read: () => Promise<{ waiting: number; active: number }>): void {
    const meter = metrics.getMeter('olly-flow');
    const waiting = meter.createObservableGauge('olly.queue.waiting', {
      description: 'Execuções aguardando na fila',
    });
    const active = meter.createObservableGauge('olly.queue.active', {
      description: 'Execuções em andamento',
    });
    meter.addBatchObservableCallback(
      async (result) => {
        const counts = await read().catch(() => undefined);
        if (!counts) return;
        result.observe(waiting, counts.waiting);
        result.observe(active, counts.active);
      },
      [waiting, active],
    );
  },
};

/** Só para testes: esquece os instrumentos criados. */
export function resetMetricsForTests(): void {
  instruments = undefined;
}
