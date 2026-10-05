import { describe, expect, it } from 'vitest';
import { CodeSandbox, MAX_CONSOLE_LINES } from './code.js';
import { findCodeReferences } from './references.js';
import { expressionData, referencedNode } from './testing.js';
import type { RunCodeRequest } from './types.js';

// Folga para CPU disputada nos testes em paralelo; o teste de timeout usa o próprio limite.
const sandbox = new CodeSandbox({ timeoutMs: 5000, memoryMb: 64 });

const run = (code: string, extra: Partial<RunCodeRequest> = {}) =>
  sandbox.runCode({
    executionId: 'e',
    code,
    mode: 'runOnceForAllItems',
    data: expressionData({ input: [{ json: { q: 2, p: 5 } }, { json: { q: 3, p: 10 } }] }),
    ...extra,
  });

describe('spec 005 — FR-009/FR-011: código JavaScript com a API do N8N', () => {
  it('FR-009/HU-3.1: $input.all() com spread devolve itens com o campo total', async () => {
    expect(
      await run(
        'return $input.all().map(i => ({ json: { ...i.json, total: i.json.q * i.json.p } }))',
      ),
    ).toEqual({
      ok: true,
      result: [{ json: { q: 2, p: 5, total: 10 } }, { json: { q: 3, p: 10, total: 30 } }],
      console: [],
    });
  });

  it('FR-009: os itens podem ser alterados e devolvidos (padrão comum no N8N)', async () => {
    const r = await run(
      'for (const item of $input.all()) item.json.visto = true; return $input.all();',
    );
    expect(r).toMatchObject({
      ok: true,
      result: [{ json: { visto: true } }, { json: { visto: true } }],
    });
  });

  it('FR-009: modo por item com $json, $itemIndex e item', async () => {
    const r = await run(
      'return { json: { dobro: $json.q * 2, i: $itemIndex, mesmo: item.json === $json } }',
      {
        mode: 'runOnceForEachItem',
      },
    );
    expect(r).toMatchObject({
      ok: true,
      result: [
        { json: { dobro: 4, i: 0, mesmo: true } },
        { json: { dobro: 6, i: 1, mesmo: true } },
      ],
    });
  });

  it('FR-009: async/await, console capturado, lodash, DateTime e $("Nó")', async () => {
    const r = await sandbox.runCode({
      executionId: 'e',
      mode: 'runOnceForAllItems',
      code: `
        const espera = await Promise.resolve(41);
        console.log('valor', espera + 1, { a: 1 });
        console.warn('aviso');
        return [{ json: {
          soma: _.sum([1, 2, 3]),
          ano: DateTime.fromISO('2026-10-04').year,
          cliente: $('Busca').first().json.nome,
          variavel: $vars.limite,
          exec: $execution.id,
        } }];`,
      data: expressionData({
        nodes: { Busca: referencedNode([{ json: { nome: 'Ana' } }]) },
        vars: { limite: 7 },
      }),
    });
    expect(r).toEqual({
      ok: true,
      result: [{ json: { soma: 6, ano: 2026, cliente: 'Ana', variavel: 7, exec: 'exec-1' } }],
      console: ['valor 42 {"a":1}', '[warn] aviso'],
    });
  });

  it('FR-012: console limitado a 500 linhas', async () => {
    const r = await run('for (let i = 0; i < 2000; i++) console.log(i); return {};');
    expect(r.console).toHaveLength(MAX_CONSOLE_LINES);
  });

  it('FR-009: erro de sintaxe e erro em tempo de execução têm mensagem clara', async () => {
    expect(await run('return {')).toMatchObject({ ok: false, error: { kind: 'syntax' } });
    const r = await run("console.log('antes'); throw new Error('falhou de propósito')");
    expect(r).toEqual({
      ok: false,
      error: { kind: 'runtime', message: 'falhou de propósito' },
      console: ['antes'],
    });
  });

  it('FR-009: nomes de nós citados no código entram no contexto', () => {
    const refs = findCodeReferences('const a = $(\'Busca\').all(); const b = $node["Outro"].json;');
    expect([...refs.names].sort()).toEqual(['Busca', 'Outro']);
    expect(refs.dynamic).toBe(false);
    expect(findCodeReferences('const n = "x"; $(n).all()').dynamic).toBe(true);
  });
});

describe('spec 005 — FR-010/SC-006: código malicioso é contido', () => {
  it.each([
    ["require('fs')", /require is not defined/],
    ['process.env', /process is not defined/],
    ["fetch('http://exemplo')", /fetch is not defined/],
    ["(function(){}).constructor('return process')()", /process is not defined/],
    ["import('fs')", /./],
    ['setTimeout(() => {}, 1)', /setTimeout is not defined/],
  ])('FR-010: %s não alcança o host', async (code, error) => {
    const r = await run(code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(error);
  });

  it('SC-006: laço infinito síncrono expira', async () => {
    const quick = new CodeSandbox({ timeoutMs: 300 });
    const started = Date.now();
    const r = await quick.runCode({
      executionId: 'e',
      code: 'while (true) {}',
      mode: 'runOnceForAllItems',
      data: expressionData(),
    });
    expect(r).toMatchObject({
      ok: false,
      error: { kind: 'timeout', message: 'Tempo limite do código excedido (300 ms)' },
    });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('SC-006: laço infinito assíncrono expira', async () => {
    const quick = new CodeSandbox({ timeoutMs: 300 });
    const r = await quick.runCode({
      executionId: 'e',
      code: 'while (true) { await null; }',
      mode: 'runOnceForAllItems',
      data: expressionData(),
    });
    expect(r).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });

  it('SC-006: alocação excessiva estoura o limite de memória sem derrubar o processo', async () => {
    const r = await run('const a = []; while (true) a.push(new Array(1e6).fill(1));');
    expect(r).toMatchObject({ ok: false, error: { kind: 'memory' } });
    // O processo segue funcionando.
    expect(await run('return { ok: 1 }')).toMatchObject({ ok: true });
  });

  it('FR-010: cada execução de nó tem isolate próprio (estado global não vaza)', async () => {
    await run('globalThis.vazou = 1; return {};');
    expect(await run('return { visto: typeof globalThis.vazou }')).toMatchObject({
      ok: true,
      result: { visto: 'undefined' },
    });
  });
});

describe('spec 006 — FR-010/NFR-001: cancelamento interrompe o código', () => {
  it('FR-010: disposeExecution interrompe um laço infinito em andamento', async () => {
    const slow = new CodeSandbox({ timeoutMs: 30_000 });
    const started = Date.now();
    const running = slow.runCode({
      executionId: 'cancelar',
      code: 'while (true) {}',
      mode: 'runOnceForAllItems',
      data: expressionData(),
    });
    await new Promise((r) => setTimeout(r, 200));
    // Outra execução não é afetada.
    slow.disposeExecution('outra');
    slow.disposeExecution('cancelar');
    expect(await running).toMatchObject({
      ok: false,
      error: { kind: 'runtime', message: 'Código interrompido: a execução foi cancelada' },
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
