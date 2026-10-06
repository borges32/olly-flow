import { describe, expect, it } from 'vitest';
import { mergeSteps, type StepView } from './agent-steps-logic';

const step = (stepIndex: number, kind: StepView['kind'], itemIndex = 0): StepView => ({
  executionId: 'e',
  nodeId: 'agent',
  runIndex: 0,
  itemIndex,
  stepIndex,
  kind,
  toolName: null,
  inputTokens: null,
  outputTokens: null,
  createdAt: '',
});

describe('spec 011 — FR-006: passos do agente no painel', () => {
  it('FR-006: junta gravados e ao vivo sem repetir, na ordem de item e passo', () => {
    const merged = mergeSteps(
      [step(0, 'model'), step(1, 'tool')],
      [step(1, 'tool'), step(2, 'final'), step(0, 'model', 1)],
    );
    expect(merged.map((s) => `${String(s.itemIndex)}:${s.kind}`)).toEqual([
      '0:model',
      '0:tool',
      '0:final',
      '1:model',
    ]);
  });
});
