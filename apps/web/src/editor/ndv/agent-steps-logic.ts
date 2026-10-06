import type { AgentStep } from '@olly/shared-types';

/** Passo gravado ou recebido ao vivo (o evento não tem `id`). */
export type StepView = Omit<AgentStep, 'id'> & { contentRedacted?: boolean };

export const stepKey = (s: Pick<StepView, 'runIndex' | 'itemIndex' | 'stepIndex'>) =>
  `${String(s.runIndex)}:${String(s.itemIndex)}:${String(s.stepIndex)}`;

/** Junta os passos gravados e os recebidos ao vivo, sem repetir, na ordem de execução. */
export function mergeSteps(stored: StepView[], live: StepView[]): StepView[] {
  const byKey = new Map<string, StepView>();
  for (const s of [...stored, ...live]) if (!byKey.has(stepKey(s))) byKey.set(stepKey(s), s);
  return [...byKey.values()].sort(
    (a, b) => a.runIndex - b.runIndex || a.itemIndex - b.itemIndex || a.stepIndex - b.stepIndex,
  );
}
