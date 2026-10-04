import { describe, expect, it } from 'vitest';
import { RecordedRun, collectInputs } from './recorded.js';

describe('spec 003 — FR-018: execução reconstruída do log (preview)', () => {
  const run = new RecordedRun([
    {
      nodeId: 'a',
      status: 'success',
      inputs: { main: [] },
      inputSources: { main: [] },
      output: { main: [{ json: { x: 1 } }] },
    },
    {
      nodeId: 'b',
      status: 'success',
      inputs: null,
      inputSources: null,
      output: { true: [{ json: { y: 2 } }], false: [] },
    },
  ]);
  const def = {
    nodes: [],
    settings: {},
    edges: [
      { id: '1', from: 'a', fromPort: 'main', to: 'c', toPort: 'main' },
      { id: '2', from: 'b', fromPort: 'true', to: 'c', toPort: 'main' },
    ],
  };

  it('FR-018: monta a entrada de um nó a partir das saídas dos pais, com a origem', () => {
    expect(collectInputs(def, run, 'c')).toEqual({
      inputs: { main: [{ json: { x: 1 } }, { json: { y: 2 } }] },
      sources: {
        main: [
          { nodeId: 'a', port: 'main', index: 0 },
          { nodeId: 'b', port: 'true', index: 0 },
        ],
      },
    });
  });

  it('FR-018: entrada definida manualmente prevalece sobre o log', () => {
    run.setInputs('a', { main: [{ json: { z: 3 } }] }, { main: [] });
    expect(run.inputsOf('a')).toEqual({ main: [{ json: { z: 3 } }] });
    expect(run.isExecuted('b')).toBe(true);
    expect(run.isExecuted('c')).toBe(false);
  });
});
