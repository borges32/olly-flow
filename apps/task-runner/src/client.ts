import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type {
  CodeRunner,
  EvaluateBatch,
  EvaluateResult,
  ExpressionEvaluator,
  RunCodeRequest,
  RunCodeResult,
} from '@olly/expressions';
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { ollyMetrics } from '@olly/telemetry';
import { responseSchema, type RunnerRequest } from './protocol.js';

/** Falhas do sandbox (não erros do código do usuário): métrica `olly.sandbox.errors`. */
const SANDBOX_FAILURES = new Set(['timeout', 'memory', 'crashed']);

/**
 * Spec 012, FR-001: span em volta da chamada ao processo filho, no processo de quem chama. O
 * filho não recebe as variáveis OTEL (ambiente mínimo, sem segredos), por isso o span nasce aqui.
 */
function traced<T>(
  name: string,
  attributes: Record<string, string | number>,
  fn: (span: Span) => Promise<T>,
) {
  return trace.getTracer('olly-flow').startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'task-runner' });
      throw error;
    } finally {
      span.end();
    }
  });
}

export interface TaskRunnerLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface TaskRunnerClientOptions {
  timeoutMs?: number;
  memoryMb?: number;
  /** Nó de código (spec 005, NFR-002). */
  codeTimeoutMs?: number;
  codeMemoryMb?: number;
  /** Arquivo do processo; padrão: `main.js` ao lado deste módulo. */
  entry?: string;
  /** Flags extras do Node para o processo (ex.: carregador de TypeScript nos testes). */
  execArgv?: string[];
  logger?: TaskRunnerLogger;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const MAX_BACKOFF_MS = 5000;

/**
 * Cliente do task runner (plan §2): inicia o processo filho sob demanda, reinicia com backoff
 * se ele cair e rejeita as requisições pendentes. Implementa `ExpressionEvaluator`.
 */
export class TaskRunnerClient implements ExpressionEvaluator, CodeRunner {
  private child?: ChildProcess;
  private ready?: Promise<void>;
  private readonly pending = new Map<string, Pending>();
  private backoffMs = 100;
  private stopped = false;
  private readonly timeoutMs: number;
  private readonly memoryMb: number;
  private readonly entry: string;

  constructor(private readonly options: TaskRunnerClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 100;
    this.memoryMb = options.memoryMb ?? 128;
    this.entry = options.entry ?? fileURLToPath(new URL('./main.js', import.meta.url));
  }

  /** Ambiente do processo filho: só o necessário, nunca os segredos da API. */
  get childEnv(): NodeJS.ProcessEnv {
    return {
      NODE_ENV: process.env.NODE_ENV ?? 'production',
      OLLY_EXPRESSION_TIMEOUT_MS: String(this.timeoutMs),
      OLLY_ISOLATE_MEMORY_MB: String(this.memoryMb),
      OLLY_CODE_TIMEOUT_MS: String(this.options.codeTimeoutMs ?? 30_000),
      OLLY_CODE_MEMORY_MB: String(this.options.codeMemoryMb ?? 128),
    };
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): Promise<void> {
    this.stopped = false;
    this.ready ??= this.spawn();
    return this.ready;
  }

  evaluateBatch(batch: EvaluateBatch): Promise<EvaluateResult[]> {
    // Margem generosa: cada expressão já tem timeout próprio dentro do runner.
    const deadline = Math.min(120_000, 5000 + batch.requests.length * this.timeoutMs);
    return traced(
      'taskrunner.evaluate',
      { 'olly.expressions.count': batch.requests.length },
      async (span) => {
        const results = (await this.request(
          { type: 'evaluateBatch', id: randomUUID(), ...batch },
          deadline,
        )) as EvaluateResult[];
        const failed = results.filter((r) => !r.ok);
        if (failed.length > 0) span.setAttribute('olly.expressions.failed', failed.length);
        for (const r of failed) {
          if (SANDBOX_FAILURES.has(r.error.kind))
            ollyMetrics.sandboxError('expression', r.error.kind);
        }
        return results;
      },
    );
  }

  /**
   * Spec 005, FR-009/FR-010: código de usuário num isolate novo. Se o processo do runner cair
   * (ex.: falta de memória do processo), o nó falha com mensagem clara e o runner reinicia.
   */
  runCode(request: RunCodeRequest): Promise<RunCodeResult> {
    const deadline = (this.options.codeTimeoutMs ?? 30_000) + 10_000;
    return traced('taskrunner.code', { 'olly.code.mode': request.mode }, async (span) => {
      let result: RunCodeResult;
      try {
        result = (await this.request(
          { type: 'runCode', id: randomUUID(), ...request },
          deadline,
        )) as RunCodeResult;
      } catch (error) {
        result = {
          ok: false,
          error: {
            kind: 'crashed',
            message: `O sandbox de código foi interrompido e reiniciado: ${error instanceof Error ? error.message : String(error)}`,
          },
          console: [],
        };
      }
      if (!result.ok) {
        // Só o tipo do erro: a mensagem pode conter dados (VIII.2).
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.error.kind });
        if (SANDBOX_FAILURES.has(result.error.kind)) {
          ollyMetrics.sandboxError('javascript', result.error.kind);
        }
      }
      return result;
    });
  }

  async disposeExecution(executionId: string): Promise<void> {
    if (!this.child) return;
    await this.request({ type: 'disposeExecution', id: randomUUID(), executionId }, 5000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    this.failPending(new Error('Task runner encerrado'));
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once('exit', () => {
        resolve();
      });
      child.disconnect();
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    });
  }

  private async request(message: RunnerRequest, deadlineMs: number): Promise<unknown> {
    await this.start();
    const child = this.child;
    if (!child?.connected) throw new Error('Task runner indisponível');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id);
        reject(new Error('Task runner não respondeu a tempo'));
        // Um runner travado é substituído.
        child.kill('SIGKILL');
      }, deadlineMs);
      this.pending.set(message.id, { resolve, reject, timer });
      child.send(message, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(message.id);
        reject(error);
      });
    });
  }

  private spawn(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = fork(this.entry, [], {
        execArgv: ['--no-node-snapshot', ...(this.options.execArgv ?? [])],
        env: this.childEnv,
        serialization: 'advanced',
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
      this.child = child;
      const startedAt = Date.now();
      let isReady = false;

      child.on('message', (raw: unknown) => {
        const parsed = responseSchema.safeParse(raw);
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === 'ready') {
          isReady = true;
          resolve();
          return;
        }
        if (message.id === null) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.type === 'result') pending.resolve(message.results);
        else if (message.type === 'ack') pending.resolve(undefined);
        else if (message.type === 'codeResult') pending.resolve(message.result);
        else pending.reject(new Error(message.message));
      });

      child.on('exit', (code, signal) => {
        if (this.child !== child) return;
        this.child = undefined;
        this.ready = undefined;
        this.failPending(new Error('O task runner foi reiniciado durante a avaliação'));
        if (!isReady) reject(new Error(`Task runner não iniciou (código ${String(code)})`));
        if (this.stopped) return;
        // Ficou de pé por um tempo: o próximo reinício volta a ser rápido.
        if (Date.now() - startedAt > 30_000) this.backoffMs = 100;
        const delay = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        this.options.logger?.warn(
          `Task runner saiu (${signal ?? String(code)}); reiniciando em ${delay} ms`,
        );
        setTimeout(() => {
          if (!this.stopped && !this.ready) this.ready = this.spawn().catch(() => undefined);
        }, delay).unref();
      });
    });
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
