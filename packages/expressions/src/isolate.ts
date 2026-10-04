import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import ivm from 'isolated-vm';
import { PRELUDE_SOURCE, wrapTemplateFunction } from './prelude.js';
import { TemplateSyntaxError, compileTemplate, literalValue, parseTemplate } from './template.js';
import type {
  EvaluateBatch,
  EvaluateResult,
  EvaluationErrorKind,
  ExpressionEvaluator,
} from './types.js';

export interface IsolateEvaluatorOptions {
  /** Tempo máximo por expressão (NFR-001). */
  timeoutMs?: number;
  /** Memória do isolate por execução (NFR-001). */
  memoryMb?: number;
  /** Isolates mantidos ao mesmo tempo; o menos usado é descartado. */
  maxSessions?: number;
}

type Compiled =
  { fn: ivm.Reference<(i: number) => unknown> } | { literal: string } | { error: string };

interface Session {
  isolate: ivm.Isolate;
  context: ivm.Context;
  compiled: Map<string, Compiled>;
}

const WARM_UP = `(() => {
  globalThis.__olly_data = { nodeName: '', params: {}, input: [{ json: { a: [1, { b: 2 }] } }], nodes: {}, paired: [],
    vars: {}, env: {}, execution: { id: '', mode: 'test' }, workflow: { id: '', name: '', active: false }, timezone: 'UTC' };
  __olly_freeze();
  const c = __olly_ctx(0);
  return __olly_s(c.$json) + __olly_s(c.$now) + JSON.stringify(__olly_out(c.$input.all()));
})()`;

let luxonSource: string | undefined;
function loadLuxon(): string {
  // O bundle "global" do Luxon define `luxon` sem `require`, como o isolate exige.
  luxonSource ??= readFileSync(
    join(dirname(createRequire(import.meta.url).resolve('luxon')), '../global/luxon.min.js'),
    'utf8',
  );
  return luxonSource;
}

function classify(
  error: unknown,
  isolate: ivm.Isolate,
): { kind: EvaluationErrorKind; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (isolate.isDisposed)
    return { kind: 'memory', message: 'Limite de memória da execução excedido' };
  if (/timed out/i.test(message))
    return { kind: 'timeout', message: 'Tempo limite da expressão excedido' };
  return { kind: 'runtime', message };
}

/**
 * Avalia expressões em lote num isolate V8 por execução (plan §2, ADR-0003). Cada avaliação tem
 * timeout próprio; o isolate tem limite de memória. Use só no task runner ou em testes.
 */
export class IsolateEvaluator implements ExpressionEvaluator {
  private readonly sessions = new Map<string, Session>();
  private readonly timeoutMs: number;
  private readonly memoryMb: number;
  private readonly maxSessions: number;

  constructor(options: IsolateEvaluatorOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 100;
    this.memoryMb = options.memoryMb ?? 128;
    this.maxSessions = options.maxSessions ?? 32;
  }

  evaluateBatch(batch: EvaluateBatch): Promise<EvaluateResult[]> {
    return Promise.resolve(this.evaluateSync(batch));
  }

  disposeExecution(executionId: string): Promise<void> {
    this.drop(executionId);
    return Promise.resolve();
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.drop(id);
  }

  private evaluateSync({ executionId, data, requests }: EvaluateBatch): EvaluateResult[] {
    const session = this.session(executionId);
    const { isolate, context } = session;
    try {
      context.global.setSync('__olly_data', new ivm.ExternalCopy(data).copyInto({ release: true }));
      context.evalSync('__olly_freeze()', { timeout: Math.max(this.timeoutMs, 1000) });
    } catch (error) {
      const failure = classify(error, isolate);
      if (isolate.isDisposed) this.drop(executionId);
      return requests.map((r) => ({ id: r.id, ok: false, error: failure }));
    }

    const results: EvaluateResult[] = [];
    for (const request of requests) {
      if (isolate.isDisposed) {
        this.drop(executionId);
        results.push({
          id: request.id,
          ok: false,
          error: { kind: 'memory', message: 'Limite de memória da execução excedido' },
        });
        continue;
      }
      const compiled = this.compile(session, request.template);
      if ('literal' in compiled) {
        results.push({ id: request.id, ok: true, value: compiled.literal });
        continue;
      }
      if ('error' in compiled) {
        results.push({
          id: request.id,
          ok: false,
          error: { kind: 'syntax', message: compiled.error },
        });
        continue;
      }
      try {
        const value: unknown = compiled.fn.applySync(undefined, [request.itemIndex], {
          timeout: this.timeoutMs,
          result: { copy: true },
        });
        results.push({ id: request.id, ok: true, value });
      } catch (error) {
        results.push({ id: request.id, ok: false, error: classify(error, isolate) });
      }
    }
    return results;
  }

  private compile(session: Session, template: string): Compiled {
    const cached = session.compiled.get(template);
    if (cached) return cached;
    let compiled: Compiled;
    try {
      const segments = parseTemplate(template.replace(/^=/, ''));
      const literal = literalValue(segments);
      if (literal !== undefined) {
        compiled = { literal };
      } else {
        const fn = session.context.evalSync(wrapTemplateFunction(compileTemplate(segments)), {
          timeout: this.timeoutMs,
          reference: true,
        }) as ivm.Reference<(i: number) => unknown>;
        compiled = { fn };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      compiled = {
        error:
          error instanceof TemplateSyntaxError
            ? message
            : `Erro de sintaxe na expressão: ${message}`,
      };
    }
    session.compiled.set(template, compiled);
    return compiled;
  }

  private session(executionId: string): Session {
    const existing = this.sessions.get(executionId);
    if (existing && !existing.isolate.isDisposed) {
      // Reinsere para manter a ordem de uso (LRU).
      this.sessions.delete(executionId);
      this.sessions.set(executionId, existing);
      return existing;
    }
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.drop(oldest);
    }
    const isolate = new ivm.Isolate({ memoryLimit: this.memoryMb });
    const context = isolate.createContextSync();
    context.evalSync(loadLuxon());
    context.evalSync(PRELUDE_SOURCE);
    // Aquece o prelude e o Luxon (compilação preguiçosa do V8) fora do limite por expressão:
    // sem isso, a primeira expressão de cada execução pode estourar o timeout sob carga.
    context.evalSync(WARM_UP, { timeout: 5000 });
    const session: Session = { isolate, context, compiled: new Map() };
    this.sessions.set(executionId, session);
    return session;
  }

  private drop(executionId: string): void {
    const session = this.sessions.get(executionId);
    this.sessions.delete(executionId);
    if (session && !session.isolate.isDisposed) session.isolate.dispose();
  }
}
