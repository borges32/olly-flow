import { describe, expect, it } from 'vitest';
import { NodeWaitSignal } from '../../errors.js';
import { fakeContext } from '../../test-support/context.js';
import { waitDuration, waitNode } from './definition.js';

const items = [{ json: { a: 1 } }, { json: { a: 2 } }];

describe('spec 008 — FR-012/NFR-002: nó Esperar', () => {
  it('FR-012: espera curta fica em memória e repassa os itens', async () => {
    const started = Date.now();
    const out = await waitNode.execute(
      { inputs: { main: items }, items },
      fakeContext({ params: { resume: 'timeInterval', amount: 0.2, unit: 'seconds' } }),
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    expect(out.main?.map((i) => i.json)).toEqual([{ a: 1 }, { a: 2 }]);
    expect(out.main?.[1]?.pairedItem).toEqual({ item: 1 });
  });

  it('NFR-002: acima de 60 s, pede espera persistida (libera o worker)', async () => {
    const run = waitNode.execute(
      { inputs: { main: items }, items },
      fakeContext({ params: { resume: 'timeInterval', amount: 2, unit: 'minutes' } }),
    );
    await expect(run).rejects.toBeInstanceOf(NodeWaitSignal);
    const signal = (await run.catch((e: unknown) => e)) as NodeWaitSignal;
    const delay = Date.parse(signal.request.resumeAt ?? '') - Date.now();
    expect(delay).toBeGreaterThan(110_000);
    expect(delay).toBeLessThanOrEqual(120_000);
  });

  it('FR-012: na retomada, segue com os itens', async () => {
    const out = await waitNode.execute(
      { inputs: { main: items }, items },
      fakeContext({
        params: { resume: 'timeInterval', amount: 2, unit: 'hours' },
        resume: { data: undefined, value: { kind: 'time' } },
      }),
    );
    expect(out.main).toHaveLength(2);
  });

  it('FR-012: até uma data/hora; data passada não espera; data inválida falha', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    const ctx = (dateTime: string) => fakeContext({ params: { resume: 'specificTime', dateTime } });
    expect(waitDuration(ctx('2026-10-06T12:05:00Z'), now).ms).toBe(300_000);
    expect(waitDuration(ctx('2026-10-06T11:00:00Z'), now).ms).toBeLessThan(0);
    expect(() => waitDuration(ctx('amanhã'), now)).toThrow(/data\/hora válida/);
  });

  it('FR-012: o cancelamento interrompe a espera em memória', async () => {
    const controller = new AbortController();
    const run = waitNode.execute(
      { inputs: { main: items }, items },
      fakeContext({
        params: { resume: 'timeInterval', amount: 30, unit: 'seconds' },
        signal: controller.signal,
      }),
    );
    controller.abort(new Error('cancelada'));
    await expect(run).rejects.toThrow('cancelada');
  });
});
