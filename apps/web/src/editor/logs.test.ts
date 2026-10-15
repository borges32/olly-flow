import { describe, expect, it } from 'vitest';
import { defaultLogSelection, formatDuration, logEntries } from './logs';
import type { NodeRunView } from './store';

const run = (extra: Partial<NodeRunView>): NodeRunView => ({
  status: 'success',
  itemsIn: 1,
  itemsOut: 1,
  pinned: false,
  reused: false,
  dataTruncated: false,
  error: null,
  ...extra,
});

describe('spec 021 — logs do editor', () => {
  it('FR-016: nós na ordem de início, com status, duração e itens; pulados ficam de fora', () => {
    const entries = logEntries(
      {
        agent: run({ startedAt: '2026-10-14T10:00:01.000Z', durationMs: 1500, itemsOut: 1 }),
        chat: run({ startedAt: '2026-10-14T10:00:00.000Z', durationMs: 3, itemsIn: 0 }),
        skip: run({ status: 'skipped', startedAt: '2026-10-14T10:00:02.000Z' }),
        old: run({ reused: true }),
      },
      { agent: 'Agente', chat: 'Chat', skip: 'Ramo', old: 'Anterior' },
    );
    expect(entries.map((e) => [e.name, e.status, e.reused])).toEqual([
      ['Anterior', 'success', true],
      ['Chat', 'success', false],
      ['Agente', 'success', false],
    ]);
    expect(entries[2]).toMatchObject({ durationMs: 1500, itemsIn: 1, itemsOut: 1 });
  });

  it('FR-016: abre no último nó com erro ou, sem erro, no último', () => {
    const entries = logEntries(
      {
        a: run({ startedAt: '2026-10-14T10:00:00.000Z' }),
        b: run({ startedAt: '2026-10-14T10:00:01.000Z', status: 'error' }),
        c: run({ startedAt: '2026-10-14T10:00:02.000Z', status: 'cancelled' }),
      },
      {},
    );
    expect(defaultLogSelection(entries)).toBe('b');
    expect(defaultLogSelection(entries.filter((e) => e.nodeId !== 'b'))).toBe('c');
    expect(defaultLogSelection([])).toBeUndefined();
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(1500)).toBe('1.50 s');
  });
});
