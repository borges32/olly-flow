import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
} from '@opentelemetry/api';
import type { Db } from '@olly/db';
import type { RunCallbacks } from '@olly/engine';
import { extractTraceContext, ollyMetrics } from '@olly/telemetry';
import type { ExecutionJob, ExecutionOutcome } from '../executions/execution-job.js';

const tracer = () => trace.getTracer('olly-flow');

/**
 * Trace e métricas de uma execução (spec 012, FR-001, FR-002, plan §2/§3): span raiz
 * `workflow.execute` (filho do contexto vindo da fila) e um `node.execute` por nó, abertos e
 * fechados pelos callbacks do motor. Só identificadores, tipos e contagens: nunca payload.
 * Sem telemetria ligada, os spans são no-op e nada é gravado.
 */
export class ExecutionTelemetry {
  private readonly nodes = new Map<string, Span>();
  private readonly types: Map<string, string>;
  private readonly startedAt = Date.now();

  private constructor(
    private readonly job: ExecutionJob,
    private readonly root: Span,
    readonly context: Context,
    private readonly trigger: string,
  ) {
    this.types = new Map(job.definition.nodes.map((n) => [n.id, n.type]));
  }

  static async start(db: Db, job: ExecutionJob): Promise<ExecutionTelemetry> {
    const parent = job.traceContext ? extractTraceContext(job.traceContext) : context.active();
    const root = tracer().startSpan(
      'workflow.execute',
      {
        kind: job.traceContext ? SpanKind.CONSUMER : SpanKind.INTERNAL,
        attributes: {
          'olly.execution.id': job.executionId,
          'olly.workflow.id': job.workflow.id,
          'olly.project.id': job.workflow.projectId,
          'olly.execution.mode': job.mode,
          ...(job.resume && { 'olly.execution.resumed': true }),
        },
      },
      parent,
    );
    let trigger = 'unknown';
    if (root.isRecording()) {
      // FR-001: o id do trace fica na execução (o da primeira, numa retomada).
      const row = await db
        .updateTable('executions')
        .set((eb) => ({
          trace_id: eb.fn.coalesce('trace_id', eb.val(root.spanContext().traceId)),
        }))
        .where('id', '=', job.executionId)
        .returning('trigger_type')
        .executeTakeFirst();
      trigger = row?.trigger_type ?? trigger;
      root.setAttribute('olly.trigger.type', trigger);
    }
    return new ExecutionTelemetry(job, root, trace.setSpan(parent, root), trigger);
  }

  private key(nodeId: string, runIndex: number) {
    return `${nodeId}:${String(runIndex)}`;
  }

  private nodeSpan(nodeId: string, runIndex: number, startedAt: Date): Span {
    return tracer().startSpan(
      'node.execute',
      {
        startTime: startedAt,
        attributes: {
          'olly.node.id': nodeId,
          'olly.node.type': this.types.get(nodeId) ?? 'unknown',
          'olly.node.run_index': runIndex,
        },
      },
      this.context,
    );
  }

  /** Acrescenta os spans de nó aos callbacks do motor (o gravador continua igual). */
  wrap(callbacks: RunCallbacks): RunCallbacks {
    return {
      ...callbacks,
      onNodeStart: async (nodeId, startedAt, runIndex) => {
        this.nodes.set(this.key(nodeId, runIndex), this.nodeSpan(nodeId, runIndex, startedAt));
        await callbacks.onNodeStart?.(nodeId, startedAt, runIndex);
      },
      onNodeFinish: async (record) => {
        const key = this.key(record.nodeId, record.runIndex);
        // Dados fixados ou reaproveitados não passam por `onNodeStart`.
        const span =
          this.nodes.get(key) ?? this.nodeSpan(record.nodeId, record.runIndex, record.startedAt);
        this.nodes.delete(key);
        span.setAttributes({
          'olly.node.status': record.status,
          'olly.items.in': record.itemsIn,
          'olly.items.out': record.itemsOut,
          ...(record.pinned && { 'olly.node.pinned': true }),
          ...(record.reused && { 'olly.node.reused': true }),
        });
        // Só o tipo do erro: a mensagem pode conter dados do item (VIII.2).
        if (record.status === 'error') {
          span.setStatus({ code: SpanStatusCode.ERROR, message: record.error?.name ?? 'Error' });
        }
        span.end(record.finishedAt);
        if (!record.pinned && !record.reused && record.status !== 'skipped') {
          ollyMetrics.node(
            this.types.get(record.nodeId) ?? 'unknown',
            record.status,
            (record.finishedAt.getTime() - record.startedAt.getTime()) / 1000,
          );
        }
        await callbacks.onNodeFinish?.(record);
      },
    };
  }

  finish(outcome: ExecutionOutcome): void {
    for (const span of this.nodes.values()) span.end();
    this.nodes.clear();
    this.root.setAttribute('olly.execution.status', outcome.status);
    if (outcome.status === 'error' || outcome.status === 'cancelled') {
      this.root.setStatus({
        code: SpanStatusCode.ERROR,
        message: outcome.error?.reason ?? outcome.status,
      });
    }
    this.root.end();
    ollyMetrics.execution(
      {
        status: outcome.status,
        trigger: this.trigger,
        mode: this.job.mode,
        project: this.job.workflow.projectId,
      },
      (Date.now() - this.startedAt) / 1000,
    );
  }
}
