import type { Db } from '@olly/db';
import { ExecutionCancelledError } from '@olly/engine';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/config.js';
import { InProcessDispatcher } from './dispatcher.js';
import type { ExecutionEventSink } from './execution-events.service.js';
import type { ExecutionJob, ExecutionOutcome } from './execution-job.js';
import type { ExecutionHooks, ExecutionRunner } from './execution-runner.js';

/** Runner falso: cada execução termina quando o teste manda. */
function fakeRunner() {
  const pending = new Map<
    string,
    { finish: (o: ExecutionOutcome) => void; hooks: ExecutionHooks }
  >();
  const runner = {
    execute: (job: ExecutionJob, hooks: ExecutionHooks) =>
      new Promise<ExecutionOutcome>((resolve) => {
        pending.set(job.executionId, { finish: resolve, hooks });
      }),
  } as unknown as ExecutionRunner;
  return { runner, pending };
}

function setup(maxConcurrent = 2) {
  const { runner, pending } = fakeRunner();
  const updates: string[] = [];
  // `UPDATE ... WHERE id = ? AND status = 'queued'`: devolve uma linha (ou o que o teste mandar).
  const db = {
    updateTable: () => ({
      set: () => ({
        where: (_c: string, _o: string, id: string) => ({
          where: () => ({
            executeTakeFirst: () => {
              updates.push(id);
              return Promise.resolve({ numUpdatedRows: 1n });
            },
            returning: () => ({
              executeTakeFirst: () => {
                updates.push(`cancel:${id}`);
                return Promise.resolve({ workflow_id: 'w' });
              },
            }),
          }),
        }),
      }),
    }),
  } as unknown as Db;
  const emit = vi.fn();
  const events = { emit } as unknown as ExecutionEventSink;
  const dispatcher = new InProcessDispatcher(runner, db, events, {
    dispatcher: { maxConcurrent },
  } as AppConfig);
  return { dispatcher, pending, updates, emit };
}

const job = (id: string): ExecutionJob => ({
  executionId: id,
  workflow: { id: 'w', name: 'W', projectId: 'p', active: false },
  definition: { nodes: [], edges: [], settings: {} },
  mode: 'test',
});
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('spec 005 — FR-003: InProcessDispatcher', () => {
  it('FR-003: limita a concorrência; o excedente espera e vira running ao ganhar vaga', async () => {
    const { dispatcher, pending, updates } = setup(2);
    void dispatcher.dispatch(job('a'));
    void dispatcher.dispatch(job('b'));
    expect(dispatcher.initialStatus()).toBe('queued');
    void dispatcher.dispatch(job('c'));
    await tick();
    expect([...pending.keys()]).toEqual(['a', 'b']);
    expect(dispatcher.stats).toEqual({ running: 2, queued: 1 });

    pending.get('a')?.finish({ status: 'success' });
    await vi.waitFor(() => {
      expect(pending.has('c')).toBe(true);
    });
    expect(updates).toEqual(['c']);
    expect(dispatcher.stats).toEqual({ running: 2, queued: 0 });
  });

  it('FR-003/FR-005: waitForResult recebe o fim, a resposta do webhook ou o timeout', async () => {
    const { dispatcher, pending } = setup(5);
    void dispatcher.dispatch(job('x'));
    void dispatcher.dispatch(job('y'));
    await tick();
    const finished = dispatcher.waitForResult('x', 1000);
    pending.get('x')?.finish({ status: 'success', lastOutput: [{ json: { ok: 1 } }] });
    expect(await finished).toEqual({
      kind: 'finished',
      outcome: { status: 'success', lastOutput: [{ json: { ok: 1 } }] },
    });
    // Quem pergunta depois do fim também recebe o resultado.
    expect(await dispatcher.waitForResult('x', 10)).toMatchObject({ kind: 'finished' });

    const response = dispatcher.waitForResult('y', 1000, true);
    pending.get('y')?.hooks.onWebhookResponse?.({ statusCode: 201, headers: {} });
    expect(await response).toEqual({
      kind: 'response',
      response: { statusCode: 201, headers: {} },
    });

    expect(await dispatcher.waitForResult('desconhecida', 20)).toEqual({ kind: 'timeout' });
  });

  it('spec 006 — FR-010: cancela a execução em andamento (sinal) ou a que espera vaga', async () => {
    const { dispatcher, pending, updates, emit } = setup(1);
    void dispatcher.dispatch(job('r'));
    void dispatcher.dispatch(job('q'));
    await tick();
    const reason = new ExecutionCancelledError('cancelled', 'Execução cancelada');
    // Em andamento: o runner recebe o sinal abortado com o motivo.
    expect(await dispatcher.cancel('r', reason)).toBe(true);
    expect(pending.get('r')?.hooks.signal?.aborted).toBe(true);
    expect(pending.get('r')?.hooks.signal?.reason).toBe(reason);
    // Esperando vaga: sai da fila, fica cancelled e quem espera recebe o desfecho.
    const waiting = dispatcher.waitForResult('q', 1000);
    expect(await dispatcher.cancel('q', reason)).toBe(true);
    expect(updates).toContain('cancel:q');
    expect(await waiting).toEqual({
      kind: 'finished',
      outcome: {
        status: 'cancelled',
        error: { message: 'Execução cancelada', reason: 'cancelled' },
      },
    });
    expect(emit).toHaveBeenCalledWith(
      'executionFinished',
      expect.objectContaining({ executionId: 'q', status: 'cancelled' }),
      'w',
    );
    expect(dispatcher.stats).toEqual({ running: 1, queued: 0 });
    expect(await dispatcher.cancel('nenhuma', reason)).toBe(false);
  });
});
