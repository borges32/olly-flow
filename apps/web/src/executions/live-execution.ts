import {
  LIVE_STEPS_LIMIT,
  type ExecutionFinishedEvent,
  type ExecutionStartedEvent,
  type ExecutionStep,
  type ExecutionSteps,
  type NodeFinishedEvent,
  type NodeStartedEvent,
} from '@olly/shared-types';

/** Eventos do WebSocket que mudam o acompanhamento (spec 029, plan §4). */
export type LiveEvent =
  | { type: 'executionStarted'; payload: ExecutionStartedEvent }
  | { type: 'nodeStarted'; payload: NodeStartedEvent }
  | { type: 'nodeFinished'; payload: NodeFinishedEvent }
  | { type: 'executionFinished'; payload: ExecutionFinishedEvent };

const stepKey = (s: { nodeId: string; runIndex: number }) => `${s.nodeId}#${String(s.runIndex)}`;

/** Insere na ordem de início (FR-003): nós em paralelo terminam fora de ordem. */
function insertByStart(steps: ExecutionStep[], step: ExecutionStep): ExecutionStep[] {
  let at = steps.length;
  while (at > 0) {
    const prev = steps[at - 1] as ExecutionStep;
    if (prev.startedAt < step.startedAt) break;
    if (prev.startedAt === step.startedAt && prev.runIndex <= step.runIndex) break;
    at--;
  }
  return [...steps.slice(0, at), step, ...steps.slice(at)];
}

function withExecuted(state: ExecutionSteps, nodeId: string): string[] {
  if (state.executedNodeIds.includes(nodeId)) return state.executedNodeIds;
  // Sub-nós e nós fora da definição não contam no progresso (FR-010).
  if (!state.nodes.some((n) => n.id === nodeId)) return state.executedNodeIds;
  return [...state.executedNodeIds, nodeId];
}

/**
 * Aplica um evento ao estado da consulta (FR-004, FR-005): sem duplicar (chave `nodeId#runIndex`,
 * o mesmo evento pode chegar duas vezes ou já estar na consulta) e com no máximo `limit` passos
 * concluídos (FR-016), contando o total.
 */
export function applyLiveEvent(
  state: ExecutionSteps,
  event: LiveEvent,
  limit = LIVE_STEPS_LIMIT,
): ExecutionSteps {
  if (event.payload.executionId !== state.id) return state;
  switch (event.type) {
    case 'executionStarted':
      // Início depois da fila ou retomada depois da espera.
      return state.status === 'queued' || state.status === 'waiting'
        ? { ...state, status: 'running', resumeAt: null }
        : state;
    case 'nodeStarted': {
      const e = event.payload;
      const key = stepKey(e);
      if (state.running.some((r) => stepKey(r) === key)) return state;
      // Já terminou (o evento chegou depois da consulta que o trouxe concluído).
      const done = state.steps.find((s) => stepKey(s) === key);
      if (done && done.status !== 'waiting') return state;
      const node = state.nodes.find((n) => n.id === e.nodeId);
      return {
        ...state,
        // Retomada do Esperar: o passo `waiting` volta a rodar (o banco troca a linha no fim).
        ...(done && {
          steps: state.steps.filter((s) => s !== done),
          total: Math.max(0, state.total - 1),
        }),
        status: state.status === 'queued' || state.status === 'waiting' ? 'running' : state.status,
        executedNodeIds: withExecuted(state, e.nodeId),
        running: [
          ...state.running,
          {
            nodeId: e.nodeId,
            nodeName: node?.name ?? done?.nodeName ?? e.nodeId,
            nodeType: node?.type ?? done?.nodeType ?? '',
            runIndex: e.runIndex,
            startedAt: e.startedAt,
          },
        ],
      };
    }
    case 'nodeFinished': {
      const e = event.payload;
      const key = stepKey(e);
      const started = state.running.find((r) => stepKey(r) === key);
      const existing = state.steps.findIndex((s) => stepKey(s) === key);
      const node = state.nodes.find((n) => n.id === e.nodeId);
      const finishedAt = started
        ? new Date(Date.parse(started.startedAt) + e.durationMs).toISOString()
        : new Date().toISOString();
      const startedAt =
        started?.startedAt ??
        state.steps[existing]?.startedAt ??
        new Date(Date.parse(finishedAt) - e.durationMs).toISOString();
      const step: ExecutionStep = {
        nodeId: e.nodeId,
        nodeName: started?.nodeName ?? node?.name ?? state.steps[existing]?.nodeName ?? e.nodeId,
        nodeType: started?.nodeType ?? node?.type ?? '',
        runIndex: e.runIndex,
        status: e.status,
        startedAt,
        finishedAt,
        itemsIn: e.itemsIn,
        itemsOut: e.itemsOut,
        error: e.error,
      };
      const running = state.running.filter((r) => stepKey(r) !== key);
      const executedNodeIds = withExecuted(state, e.nodeId);
      if (existing >= 0) {
        // Retomada do Esperar (o passo `waiting` vira o final) ou evento repetido.
        const steps = state.steps.slice();
        steps[existing] = step;
        return { ...state, steps, running, executedNodeIds };
      }
      // Passo que ficou fora das últimas `limit` linhas da consulta: já está no total.
      const first = state.steps[0];
      if (state.total > state.steps.length && first && startedAt < first.startedAt) {
        return { ...state, running, executedNodeIds };
      }
      const steps = insertByStart(state.steps, step);
      if (steps.length > limit) steps.splice(0, steps.length - limit);
      return { ...state, steps, running, executedNodeIds, total: state.total + 1 };
    }
    case 'executionFinished': {
      const e = event.payload;
      return {
        ...state,
        status: e.status,
        finishedAt: e.finishedAt,
        error: e.error,
        running: [],
      };
    }
  }
}

/** Aplica os eventos guardados (chegados antes ou durante a consulta) sobre o resultado dela. */
export const applyLiveEvents = (state: ExecutionSteps, events: LiveEvent[], limit?: number) =>
  events.reduce((s, e) => applyLiveEvent(s, e, limit), state);
