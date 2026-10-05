import { describe, expect, it } from 'vitest';
import { timelineRows } from './timeline';
import type { NodeRunView } from './store';

const view = (extra: Partial<NodeRunView>): NodeRunView => ({
  status: 'success',
  itemsIn: 1,
  itemsOut: 1,
  pinned: false,
  reused: false,
  dataTruncated: false,
  error: null,
  ...extra,
});

describe('spec 006 — FR-013: linha do tempo da execução', () => {
  it('FR-013: ordena por início, calcula o fim e deixa aberto o nó em execução', () => {
    const rows = timelineRows(
      {
        b: view({ startedAt: '2026-10-05T10:00:00.100Z', durationMs: 1000 }),
        a: view({ startedAt: '2026-10-05T10:00:00.000Z', durationMs: 50 }),
        c: view({ status: 'running', startedAt: '2026-10-05T10:00:00.100Z' }),
        pulado: view({ status: 'skipped', startedAt: '2026-10-05T10:00:00.000Z' }),
        reaproveitado: view({ reused: true, startedAt: '2026-10-05T10:00:00.000Z' }),
      },
      { a: 'Início', b: 'HTTP 1', c: 'HTTP 2' },
    );
    const t0 = Date.parse('2026-10-05T10:00:00.000Z');
    expect(rows).toEqual([
      { nodeId: 'a', name: 'Início', status: 'success', start: t0, end: t0 + 50 },
      { nodeId: 'b', name: 'HTTP 1', status: 'success', start: t0 + 100, end: t0 + 1100 },
      { nodeId: 'c', name: 'HTTP 2', status: 'running', start: t0 + 100, end: null },
    ]);
  });
});
