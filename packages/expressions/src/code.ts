import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import ivm from 'isolated-vm';
import { PRELUDE_SOURCE } from './prelude.js';
import type { CodeRunner, RunCodeRequest, RunCodeResult } from './types.js';

export interface CodeSandboxOptions {
  /** Tempo máximo do código (NFR-002, `OLLY_CODE_TIMEOUT_MS`). */
  timeoutMs?: number;
  /** Memória do isolate (NFR-002). */
  memoryMb?: number;
}

export const MAX_CONSOLE_LINES = 500;
const MAX_CONSOLE_LINE = 10_000;

const require = createRequire(import.meta.url);
let sources: { luxon: string; lodash: string } | undefined;
function libraries() {
  // Bundles "globais" (sem `require`), como o isolate exige.
  sources ??= {
    luxon: readFileSync(join(dirname(require.resolve('luxon')), '../global/luxon.min.js'), 'utf8'),
    lodash: readFileSync(require.resolve('lodash/lodash.min.js'), 'utf8'),
  };
  return sources;
}

/** `console` dentro do isolate: formata e manda cada linha ao host (`__olly_log`). */
const CONSOLE_PRELUDE = String.raw`
(function () {
  const g = globalThis;
  const fmt = (args) => args.map((v) => {
    if (typeof v === 'string') return v;
    try { const s = JSON.stringify(g.__olly_out(v)); return s === undefined ? String(v) : s; }
    catch (e) { return String(v); }
  }).join(' ');
  const make = (level) => (...args) => g.__olly_log(level === 'log' ? fmt(args) : '[' + level + '] ' + fmt(args));
  g.console = { log: make('log'), info: make('info'), warn: make('warn'), error: make('error'), debug: make('debug') };
})();
`;

const VARS = '$input, $, $node, $vars, $env, $execution, $workflow, $parameter, $now, $today';

/**
 * Envolve o código do usuário numa função assíncrona com as variáveis do N8N (FR-009). No modo
 * por item, roda uma vez para cada item de entrada com `$json`, `$binary`, `$itemIndex` e `item`.
 */
export function wrapUserCode(code: string, mode: RunCodeRequest['mode']): string {
  if (mode === 'runOnceForEachItem') {
    return `(async () => {
  const __olly_results = [];
  for (let __olly_i = 0; __olly_i < __olly_data.input.length; __olly_i++) {
    const { $json, $binary, $itemIndex, ${VARS} } = __olly_ctx(__olly_i);
    const item = $input.item;
    __olly_results.push(__olly_out(await (async () => {
${code}
    })()));
  }
  return __olly_results;
})()`;
  }
  return `(async () => {
  const { ${VARS} } = __olly_ctx(0);
  const items = $input.all();
  return __olly_out(await (async () => {
${code}
  })());
})()`;
}

class CodeTimeoutError extends Error {}

/**
 * Executa código JavaScript de usuário num isolate novo por execução de nó (plan §5, ADR-0003):
 * sem `require`, processo, rede ou sistema de arquivos, com limite de memória e de tempo.
 */
export class CodeSandbox implements CodeRunner {
  private readonly timeoutMs: number;
  private readonly memoryMb: number;
  /** Isolates em uso por execução, para o cancelamento (spec 006, FR-010). */
  private readonly running = new Map<string, Set<ivm.Isolate>>();
  private readonly cancelled = new WeakSet<ivm.Isolate>();

  constructor(options: CodeSandboxOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.memoryMb = options.memoryMb ?? 128;
  }

  async runCode({ executionId, code, mode, data }: RunCodeRequest): Promise<RunCodeResult> {
    const consoleLines: string[] = [];
    const isolate = new ivm.Isolate({ memoryLimit: this.memoryMb });
    const isolates = this.running.get(executionId) ?? new Set();
    isolates.add(isolate);
    this.running.set(executionId, isolates);
    let timer: NodeJS.Timeout | undefined;
    try {
      const context = await isolate.createContext();
      const { luxon, lodash } = libraries();
      await context.eval(luxon);
      await context.eval(lodash);
      await context.eval(PRELUDE_SOURCE);
      await context.global.set(
        '__olly_log',
        new ivm.Callback(
          (line: unknown) => {
            if (consoleLines.length < MAX_CONSOLE_LINES)
              consoleLines.push(String(line).slice(0, MAX_CONSOLE_LINE));
          },
          { ignored: true },
        ),
      );
      await context.eval(CONSOLE_PRELUDE);
      // Sem congelar: no N8N, o código pode alterar os itens recebidos e devolvê-los.
      await context.global.set(
        '__olly_data',
        new ivm.ExternalCopy(data).copyInto({ release: true }),
      );

      let script: ivm.Script;
      try {
        script = await isolate.compileScript(wrapUserCode(code, mode), { filename: 'codigo.js' });
      } catch (error) {
        return {
          ok: false,
          error: { kind: 'syntax', message: `Erro de sintaxe no código: ${message(error)}` },
          console: consoleLines,
        };
      }
      // Relógio do host além do timeout do V8: cobre continuações assíncronas sem fim.
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new CodeTimeoutError());
        }, this.timeoutMs);
      });
      const result: unknown = await Promise.race([
        script.run(context, { timeout: this.timeoutMs, promise: true, copy: true }),
        deadline,
      ]);
      return { ok: true, result, console: consoleLines };
    } catch (error) {
      return { ok: false, error: this.classify(error, isolate), console: consoleLines };
    } finally {
      clearTimeout(timer);
      if (!isolate.isDisposed) isolate.dispose();
      isolates.delete(isolate);
      if (isolates.size === 0) this.running.delete(executionId);
    }
  }

  /** Interrompe o código ainda em andamento da execução (cancelamento, spec 006 FR-010). */
  disposeExecution(executionId: string): void {
    for (const isolate of this.running.get(executionId) ?? []) {
      this.cancelled.add(isolate);
      if (!isolate.isDisposed) isolate.dispose();
    }
    this.running.delete(executionId);
  }

  private classify(
    error: unknown,
    isolate: ivm.Isolate,
  ): Extract<RunCodeResult, { ok: false }>['error'] {
    if (this.cancelled.has(isolate)) {
      return { kind: 'runtime', message: 'Código interrompido: a execução foi cancelada' };
    }
    if (error instanceof CodeTimeoutError || /timed out/i.test(message(error))) {
      return { kind: 'timeout', message: `Tempo limite do código excedido (${this.timeoutMs} ms)` };
    }
    if (isolate.isDisposed || /memory limit/i.test(message(error))) {
      return {
        kind: 'memory',
        message: `Limite de memória do código excedido (${this.memoryMb} MB)`,
      };
    }
    return { kind: 'runtime', message: message(error) };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
