import { describe, expect, it } from 'vitest';
import { analyzeLoops, type GraphEdge } from './graph.js';
import { resolveNodePorts } from './ports.js';

const e = (from: string, to: string, toPort = 'main', fromPort = 'main'): GraphEdge => ({
  id: `${from}:${fromPort}->${to}:${toPort}`,
  from,
  fromPort,
  to,
  toPort,
});
const loopNodes = new Set(['w', 'w2']);
const isLoop = (id: string) => loopNodes.has(id);

describe('spec 007 — FR-008: ciclos só pela porta continue de um nó de laço', () => {
  it('FR-008: laço válido: entrada única pelo While e volta pela continue', () => {
    const r = analyzeLoops(
      ['m', 'w', 'a', 'b', 'fim'],
      [
        e('m', 'w'),
        e('w', 'a', 'main', 'loop'),
        e('a', 'b'),
        e('b', 'w', 'continue'),
        e('w', 'fim', 'main', 'done'),
      ],
      isLoop,
    );
    expect(r.invalid).toEqual([]);
    expect(r.loops).toHaveLength(1);
    expect(r.loops[0]?.header).toBe('w');
    expect([...(r.loops[0]?.body ?? [])].sort()).toEqual(['a', 'b']);
    expect([...r.backEdges]).toEqual(['b:main->w:continue']);
  });

  it('SC-005: ciclo sem nó de laço é rejeitado', () => {
    const r = analyzeLoops(['a', 'b'], [e('a', 'b'), e('b', 'a')], isLoop);
    expect(r.loops).toEqual([]);
    expect(r.invalid[0]?.reason).toMatch(/entrada "continue"/);
  });

  it('SC-005: volta pela entrada principal do While é rejeitada', () => {
    const r = analyzeLoops(['w', 'a'], [e('w', 'a', 'main', 'loop'), e('a', 'w', 'main')], isLoop);
    expect(r.invalid).toHaveLength(1);
  });

  it('SC-005: conexão de fora entrando no meio do corpo é rejeitada (sem dominância)', () => {
    const r = analyzeLoops(
      ['m', 'w', 'a', 'b'],
      [e('m', 'w'), e('m', 'b'), e('w', 'a', 'main', 'loop'), e('a', 'b'), e('b', 'w', 'continue')],
      isLoop,
    );
    expect(r.invalid[0]?.reason).toMatch(/só pode receber conexões de fora/);
  });

  it('FR-008: laços aninhados são válidos e o interno conhece o externo', () => {
    const r = analyzeLoops(
      ['w', 'w2', 'x', 'y'],
      [
        e('w', 'w2', 'main', 'loop'),
        e('w2', 'x', 'main', 'loop'),
        e('x', 'w2', 'continue'),
        e('w2', 'y', 'main', 'done'),
        e('y', 'w', 'continue'),
      ],
      isLoop,
    );
    expect(r.invalid).toEqual([]);
    expect(r.loops.map((l) => [l.header, l.parent])).toEqual([
      ['w', undefined],
      ['w2', 'w'],
    ]);
  });
});

describe('spec 007 — FR-001/FR-012/FR-013: portas dinâmicas', () => {
  const base = {
    inputs: [{ name: 'main', kind: 'main' as const }],
    outputs: [{ name: 'main', kind: 'main' as const }],
  };
  it('FR-001: Merge com N entradas (2–10)', () => {
    const merge = { ...base, dynamicPorts: { kind: 'mergeInputs' as const } };
    expect(
      resolveNodePorts(merge, { params: { numberInputs: 3 } }).inputs.map((p) => p.name),
    ).toEqual(['input1', 'input2', 'input3']);
    expect(resolveNodePorts(merge, { params: { numberInputs: 50 } }).inputs).toHaveLength(10);
    expect(resolveNodePorts(merge, { params: {} }).inputs).toHaveLength(2);
  });

  it('FR-012: Switch com uma saída por regra e fallback extra', () => {
    const sw = { ...base, dynamicPorts: { kind: 'switchOutputs' as const } };
    const ports = resolveNodePorts(sw, {
      params: { rules: [{ outputKey: 'SP' }, {}], options: { fallbackOutput: 'extra' } },
    });
    expect(ports.outputs.map((p) => [p.name, p.displayName])).toEqual([
      ['output0', 'SP'],
      ['output1', 'Saída 1'],
      ['fallback', 'Padrão'],
    ]);
    expect(
      resolveNodePorts(sw, { params: { mode: 'expression', numberOutputs: 2 } }).outputs,
    ).toHaveLength(2);
  });

  it('FR-013: onError = errorOutput acrescenta a saída error', () => {
    expect(
      resolveNodePorts(base, { params: {}, settings: { onError: 'errorOutput' } }).outputs.map(
        (p) => p.name,
      ),
    ).toEqual(['main', 'error']);
  });
});
