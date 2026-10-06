import { describe, expect, it } from 'vitest';
import { BOTTOM_PORT_SPACING, SIDE_PORT_SPACING, nodeMinSize } from './node-layout';

describe('layout do nó no canvas', () => {
  it('spec 007: Merge com 5 entradas cresce na altura (portas espaçadas)', () => {
    const { minHeight } = nodeMinSize({ inputs: 5, outputs: 1, bottom: 0 });
    expect(minHeight).toBe(6 * SIDE_PORT_SPACING);
    // Distância entre portas vizinhas (handles distribuídos em (i + 1) / (n + 1)).
    expect((minHeight ?? 0) / 6).toBeGreaterThanOrEqual(SIDE_PORT_SPACING);
  });

  it('spec 011, FR-001: Agent com 3 portas de sub-nó cresce na largura (rótulos sem sobrepor)', () => {
    expect(nodeMinSize({ inputs: 1, outputs: 1, bottom: 3 })).toEqual({
      minWidth: 4 * BOTTOM_PORT_SPACING,
    });
  });

  it('nós comuns mantêm o tamanho padrão', () => {
    expect(nodeMinSize({ inputs: 1, outputs: 1, bottom: 0 })).toEqual({});
    expect(nodeMinSize({ inputs: 1, outputs: 2, bottom: 0 })).toEqual({});
  });
});
