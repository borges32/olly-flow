import { afterAll, describe, expect, it } from 'vitest';
import { IsolateEvaluator } from './isolate.js';
import { expressionData } from './testing.js';
import type { EvaluateResult } from './types.js';

const evaluator = new IsolateEvaluator();
afterAll(() => {
  evaluator.disposeAll();
});

async function run(
  template: string,
  executionId = 'sandbox',
  ev = evaluator,
): Promise<EvaluateResult> {
  const [r] = await ev.evaluateBatch({
    executionId,
    data: expressionData(),
    requests: [{ id: '1', template, itemIndex: 0 }],
  });
  if (!r) throw new Error('sem resultado');
  return r;
}

describe('spec 003 — FR-006/SC-003/SC-004: isolamento do sandbox de expressões', () => {
  it.each([
    ['process', '={{ typeof process }}'],
    ['require', '={{ typeof require }}'],
    ['module', '={{ typeof module }}'],
    ['fetch', '={{ typeof fetch }}'],
    ['XMLHttpRequest', '={{ typeof XMLHttpRequest }}'],
    ['setTimeout', '={{ typeof setTimeout }}'],
    ['constructor.constructor', '={{ this.constructor.constructor("return typeof process")() }}'],
    ['Function via $json', '={{ $json.constructor.constructor("return typeof require")() }}'],
    ['import dinâmico', '={{ typeof globalThis.import }}'],
  ])('SC-004: sem acesso a %s', async (_d, template) => {
    expect(await run(template)).toEqual({ id: '1', ok: true, value: 'undefined' });
  });

  it('SC-004: import() dinâmico não carrega módulos do host', async () => {
    for (const template of [
      '={{ import("node:fs") }}',
      '={{ (async () => (await import("node:fs")).readFileSync)() }}',
    ]) {
      const r = await run(template);
      // Ou falha, ou devolve uma promessa vazia: nunca o módulo.
      if (r.ok) expect(r.value).not.toHaveProperty('readFileSync');
      else expect(r.error.kind).toBe('runtime');
    }
  });

  it('SC-003/NFR-001: laço infinito é interrompido pelo timeout de 100 ms', async () => {
    const started = Date.now();
    const r = await run('={{ (() => { while (true) {} })() }}');
    expect(r).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await run('={{ 1 + 1 }}')).toMatchObject({ ok: true, value: 2 });
  });

  it('FR-006/NFR-001: estouro do limite de memória derruba só o isolate da execução', async () => {
    const tight = new IsolateEvaluator({ timeoutMs: 10_000, memoryMb: 16 });
    const r = await run(
      '={{ (() => { const a = []; while (true) a.push(new Array(1e6).fill(1)); })() }}',
      'mem',
      tight,
    );
    expect(r).toMatchObject({ ok: false, error: { kind: 'memory' } });
    expect(await run('={{ "de pé" }}', 'mem', tight)).toMatchObject({ ok: true, value: 'de pé' });
    tight.disposeAll();
  });

  it('FR-006: execuções diferentes não compartilham estado global', async () => {
    await run('={{ (globalThis.vazou = 1) }}', 'exec-a');
    expect(await run('={{ typeof globalThis.vazou }}', 'exec-b')).toMatchObject({
      ok: true,
      value: 'undefined',
    });
  });
});

describe('spec 003 — NFR-002: avaliação em lote', () => {
  it('NFR-002: 1000 itens × 3 expressões em menos de 1 s', async () => {
    const input = Array.from({ length: 1000 }, (_, i) => ({ json: { n: i, nome: `Pessoa ${i}` } }));
    const templates = ['={{ $json.n * 2 }}', '=Olá {{ $json.nome }}', '={{ $json.n % 2 === 0 }}'];
    const requests = input.flatMap((_, i) =>
      templates.map((template, t) => ({ id: `${i}:${t}`, template, itemIndex: i })),
    );
    const started = performance.now();
    const results = await evaluator.evaluateBatch({
      executionId: 'perf',
      data: expressionData({ input }),
      requests,
    });
    const elapsed = performance.now() - started;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[2997]).toEqual({ id: '999:0', ok: true, value: 1998 });
    console.log(`NFR-002: 3000 expressões em ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(1000);
  });
});
