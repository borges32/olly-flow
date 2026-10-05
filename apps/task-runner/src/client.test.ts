import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExpressionData } from '@olly/expressions';
import { TaskRunnerClient } from './client.js';

// Roda o processo a partir do código-fonte (tsx), sem depender do build.
const client = new TaskRunnerClient({
  entry: new URL('./main.ts', import.meta.url).pathname,
  execArgv: ['--import', 'tsx'],
});

const data: ExpressionData = {
  nodeName: 'N',
  params: {},
  input: [{ json: { nome: 'Ana' } }],
  nodes: {},
  paired: [],
  vars: {},
  env: {},
  execution: { id: 'e', mode: 'test' },
  workflow: { id: 'w', name: 'W', active: false },
  timezone: 'UTC',
};

const evaluate = (template: string, executionId = 'e1') =>
  client.evaluateBatch({ executionId, data, requests: [{ id: '1', template, itemIndex: 0 }] });

beforeAll(async () => {
  await client.start();
});
afterAll(async () => {
  await client.stop();
});

describe('spec 003 — FR-006: task runner em processo separado', () => {
  it('FR-006: avalia expressões no processo filho', async () => {
    expect(client.pid).not.toBe(process.pid);
    expect(await evaluate('=Olá {{ $json.nome }}')).toEqual([
      { id: '1', ok: true, value: 'Olá Ana' },
    ]);
  });

  it('FR-006: preserva undefined e tipos ao cruzar o IPC', async () => {
    expect(await evaluate('={{ $json.nada }}')).toEqual([{ id: '1', ok: true, value: undefined }]);
  });

  it('SC-003: laço infinito expira e o processo principal segue responsivo', async () => {
    let ticks = 0;
    const interval = setInterval(() => ticks++, 10);
    const [result] = await evaluate('={{ (() => { while (true) {} })() }}');
    clearInterval(interval);
    expect(result).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    expect(ticks).toBeGreaterThan(3);
  });

  it('FR-006: o processo filho não recebe as variáveis de ambiente da API', () => {
    expect(Object.keys(client.childEnv).sort()).toEqual([
      'NODE_ENV',
      'OLLY_CODE_MEMORY_MB',
      'OLLY_CODE_TIMEOUT_MS',
      'OLLY_EXPRESSION_TIMEOUT_MS',
      'OLLY_ISOLATE_MEMORY_MB',
    ]);
  });

  it('FR-006: se o processo cair, é reiniciado e volta a atender', async () => {
    const before = client.pid;
    process.kill(before ?? 0, 'SIGKILL');
    await expect
      .poll(() => client.pid !== undefined && client.pid !== before, { timeout: 10_000 })
      .toBe(true);
    expect(await evaluate('={{ 2 + 2 }}')).toEqual([{ id: '1', ok: true, value: 4 }]);
  });

  it('FR-006: descarta o isolate da execução', async () => {
    await evaluate('={{ (globalThis.x = 1) }}', 'e-dispose');
    await client.disposeExecution('e-dispose');
    expect(await evaluate('={{ typeof globalThis.x }}', 'e-dispose')).toEqual([
      { id: '1', ok: true, value: 'undefined' },
    ]);
  });
});

describe('spec 005 — FR-009/FR-010: código JavaScript no task runner', () => {
  it('FR-009: roda o código no processo filho, com console', async () => {
    expect(
      await client.runCode({
        executionId: 'c1',
        code: "console.log('oi'); return $input.all().map(i => ({ json: { saudacao: 'Olá ' + i.json.nome } }))",
        mode: 'runOnceForAllItems',
        data,
      }),
    ).toEqual({ ok: true, result: [{ json: { saudacao: 'Olá Ana' } }], console: ['oi'] });
  });

  it('caso de borda: o processo do sandbox morre durante o código — o nó falha e o runner reinicia', async () => {
    const pending = client.runCode({
      executionId: 'c2',
      code: 'while (true) {}',
      mode: 'runOnceForAllItems',
      data,
    });
    await new Promise((r) => setTimeout(r, 300));
    process.kill(client.pid ?? 0, 'SIGKILL');
    expect(await pending).toMatchObject({
      ok: false,
      error: { kind: 'crashed', message: expect.stringContaining('reiniciado') as string },
    });
    await expect
      .poll(
        async () =>
          (
            await client.runCode({
              executionId: 'c3',
              code: 'return { ok: 1 }',
              mode: 'runOnceForAllItems',
              data,
            })
          ).ok,
        {
          timeout: 10_000,
        },
      )
      .toBe(true);
  });
});
