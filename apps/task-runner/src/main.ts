import type { EvaluateBatch, RunCodeRequest } from '@olly/expressions';
import { CodeSandbox, IsolateEvaluator } from '@olly/expressions/isolate';
import { requestSchema, type RunnerResponse } from './protocol.js';

// Processo filho do TaskRunnerClient. Só fala por IPC; não abre portas nem lê segredos.
if (!process.send) {
  console.error('O task runner deve ser iniciado pelo TaskRunnerClient (IPC).');
  process.exit(1);
}

const number = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const evaluator = new IsolateEvaluator({
  timeoutMs: number(process.env.OLLY_EXPRESSION_TIMEOUT_MS, 100),
  memoryMb: number(process.env.OLLY_ISOLATE_MEMORY_MB, 128),
});

const code = new CodeSandbox({
  timeoutMs: number(process.env.OLLY_CODE_TIMEOUT_MS, 30_000),
  memoryMb: number(process.env.OLLY_CODE_MEMORY_MB, 128),
});

function reply(message: RunnerResponse): void {
  // O cliente pode ter encerrado o canal (ex.: API fechando antes do "ready").
  if (!process.connected) return;
  process.send?.(message, undefined, {}, (error: Error | null) => {
    if (error) process.exit(0);
  });
}

process.on('message', (raw: unknown) => {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    const id = (raw as { id?: unknown } | null)?.id;
    reply({
      type: 'error',
      id: typeof id === 'string' ? id : null,
      message: 'Mensagem inválida para o task runner',
    });
    return;
  }
  const message = parsed.data;
  if (message.type === 'runCode') {
    void code.runCode(message as RunCodeRequest).then((result) => {
      reply({ type: 'codeResult', id: message.id, result });
    });
    return;
  }
  if (message.type === 'disposeExecution') {
    // Também interrompe código em andamento da execução (cancelamento, spec 006).
    code.disposeExecution(message.executionId);
    void evaluator.disposeExecution(message.executionId).then(() => {
      reply({ type: 'ack', id: message.id });
    });
    return;
  }
  evaluator
    .evaluateBatch(message as EvaluateBatch)
    .then((results) => {
      reply({ type: 'result', id: message.id, results });
    })
    .catch((error: unknown) => {
      reply({
        type: 'error',
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      });
    });
});

process.on('disconnect', () => {
  evaluator.disposeAll();
  process.exit(0);
});

reply({ type: 'ready' });
