import {
  LIVE_STEPS_LIMIT,
  type ExecutionFinishedEvent,
  type ExecutionStartedEvent,
  type ExecutionSteps,
  type NodeFinishedEvent,
  type NodeStartedEvent,
} from '@olly/shared-types';
import { useEffect, useState } from 'react';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { executionSocket } from '@/api/execution-socket';
import { useAuth } from '@/auth/auth-provider';
import { isActiveStatus } from './execution-log';
import { applyLiveEvents, type LiveEvent } from './live-execution';

/** Consulta de reserva enquanto a execução está ativa, para cobrir eventos perdidos (FR-009). */
const RESERVE_POLL_MS = 15_000;
/** Depois que um "Executar workflow" começa, a consulta traz o link da subexecução (FR-011). */
const SUB_EXECUTION_REFRESH_MS = 1500;

export interface LiveExecution {
  data: ExecutionSteps | undefined;
  /** Relógio para o tempo decorrido e a duração dos passos em andamento (FR-002, FR-003). */
  now: number;
  /** `false` enquanto o WebSocket está fora, durante o acompanhamento (FR-009). */
  connected: boolean;
  /** A execução não existe (excluída) ou o usuário não tem `execution:read` (FR-012). */
  gone: boolean;
  failed: boolean;
}

/**
 * Acompanhamento ao vivo (spec 029, plan §4). Com a execução ativa: entra na sala sem dados
 * (`metadataOnly`) **antes** da consulta leve, guarda os eventos que chegam durante ela e os
 * aplica por cima do resultado, sem duplicar. Ao reconectar, entra de novo e ressincroniza. No
 * fim, busca o Log completo (sem limite) e para de escutar. Execução já terminada: só o Log.
 */
export function useLiveExecution(executionId: string, activeHint: boolean): LiveExecution {
  const api = useApi();
  const { getAccessToken } = useAuth();
  const [data, setData] = useState<ExecutionSteps>();
  const [connected, setConnected] = useState(true);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const socket = executionSocket(getAccessToken);
    let disposed = false;
    let listening = false;
    let current: ExecutionSteps | undefined;
    let seq = 0;
    let inFlight = false;
    /** Eventos chegados durante a consulta: aplicados por cima do resultado dela. */
    let pending: LiveEvent[] = [];
    /** Eventos agrupados por quadro, para não renderizar a cada um num laço rápido. */
    let batch: LiveEvent[] = [];
    let flushTimer: number | undefined;
    let subTimer: ReturnType<typeof setTimeout> | undefined;

    const commit = (next: ExecutionSteps) => {
      current = next;
      setData(next);
      setNow(Date.now());
    };

    const load = (full: boolean) => {
      const mine = ++seq;
      inFlight = true;
      const query = full ? '' : `?limit=${String(LIVE_STEPS_LIMIT)}`;
      api
        .get<ExecutionSteps>(`/api/v1/executions/${executionId}/steps${query}`)
        .then((res) => {
          if (disposed || mine !== seq) return;
          inFlight = false;
          const next = applyLiveEvents(res, pending, full ? Infinity : LIVE_STEPS_LIMIT);
          pending = [];
          setFailed(false);
          commit(next);
          if (isActiveStatus(next.status)) {
            // Ativa sem o aviso de quem abriu (lista desatualizada): passa a acompanhar.
            if (start())
              void join().then(() => {
                if (!disposed) load(false);
              });
          } else {
            stop();
            // Terminou durante o acompanhamento: o Log completo, sem o limite (FR-008, FR-016).
            if (!full) load(true);
          }
        })
        .catch((error: unknown) => {
          if (disposed || mine !== seq) return;
          inFlight = false;
          if (error instanceof ApiError && error.status === 404) {
            setGone(true);
            stop();
          } else setFailed(true);
        });
    };

    const flush = () => {
      flushTimer = undefined;
      const events = batch;
      batch = [];
      if (!current || events.length === 0) return;
      commit(applyLiveEvents(current, events));
      const end = [...events].reverse().find((e) => e.type === 'executionFinished');
      // Espera: a consulta traz o horário de retomada (FR-007); fim: o Log completo (FR-008).
      if (end) load(end.payload.status !== 'waiting');
    };

    const receive = (event: LiveEvent) => {
      if (event.payload.executionId !== executionId || !listening) return;
      if (inFlight || !current) pending.push(event);
      if (!current) return;
      batch.push(event);
      if (event.type === 'nodeStarted') {
        const type = current.nodes.find((n) => n.id === event.payload.nodeId)?.type;
        if (type === 'flow.executeWorkflow') {
          clearTimeout(subTimer);
          subTimer = setTimeout(() => {
            load(false);
          }, SUB_EXECUTION_REFRESH_MS);
        }
      }
      if (flushTimer !== undefined) return;
      flushTimer = document.hidden
        ? window.setTimeout(flush, 500)
        : window.requestAnimationFrame(flush);
    };

    const onStarted = (payload: ExecutionStartedEvent) => {
      receive({ type: 'executionStarted', payload });
    };
    const onNodeStarted = (payload: NodeStartedEvent) => {
      receive({ type: 'nodeStarted', payload });
    };
    const onNodeFinished = (payload: NodeFinishedEvent) => {
      receive({ type: 'nodeFinished', payload });
    };
    const onFinished = (payload: ExecutionFinishedEvent) => {
      receive({ type: 'executionFinished', payload });
    };
    const join = () =>
      socket
        .timeout(3000)
        .emitWithAck('join', { executionId, metadataOnly: true })
        .catch(() => undefined);
    const onConnect = () => {
      setConnected(true);
      // Ressincroniza: entra de novo na sala e só então consulta (FR-009).
      void join().then(() => {
        if (!disposed && listening) load(false);
      });
    };
    const onDisconnect = () => {
      setConnected(false);
    };
    const poll = setInterval(() => {
      if (listening && !document.hidden) load(false);
    }, RESERVE_POLL_MS);

    function start(): boolean {
      if (listening || disposed) return false;
      listening = true;
      socket.on('executionStarted', onStarted);
      socket.on('nodeStarted', onNodeStarted);
      socket.on('nodeFinished', onNodeFinished);
      socket.on('executionFinished', onFinished);
      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('connect_error', onDisconnect);
      return true;
    }
    function stop() {
      if (!listening) return;
      listening = false;
      clearTimeout(subTimer);
      socket.off('executionStarted', onStarted);
      socket.off('nodeStarted', onNodeStarted);
      socket.off('nodeFinished', onNodeFinished);
      socket.off('executionFinished', onFinished);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onDisconnect);
      socket.emit('leave', { executionId });
      setConnected(true);
    }

    if (activeHint) {
      // A assinatura vem antes da consulta: nenhum evento se perde entre as duas (FR-005).
      start();
      if (socket.connected) {
        void join().then(() => {
          if (!disposed) load(false);
        });
      } else load(false);
    } else load(true);

    return () => {
      disposed = true;
      clearInterval(poll);
      clearTimeout(subTimer);
      if (flushTimer !== undefined) {
        window.cancelAnimationFrame(flushTimer);
        window.clearTimeout(flushTimer);
      }
      stop();
    };
  }, [api, executionId, activeHint, getAccessToken]);

  // O relógio só corre com a execução ativa (FR-002).
  const ticking = data ? isActiveStatus(data.status) : false;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [ticking]);

  return { data, now, connected, gone, failed };
}
