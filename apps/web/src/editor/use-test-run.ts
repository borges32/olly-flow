import type {
  ExecutionDetail,
  ExecutionFinishedEvent,
  NodeFinishedEvent,
  NodeStartedEvent,
  TestRunResponse,
} from '@olly/shared-types';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { executionSocket } from '@/api/execution-socket';
import { useAuth } from '@/auth/auth-provider';
import { useEditorStore } from './store';

type Buffered = (executionId: string) => void;
const MAX_BUFFERED_EXECUTIONS = 20;

/**
 * Execução de teste a partir do editor (FR-011) com acompanhamento em tempo real (FR-012).
 * O editor entra na sala do workflow ao abrir; eventos de uma execução cujo id ainda não
 * voltou do POST ficam guardados e são aplicados assim que ele chega.
 */
export function useTestRun(workflowId: string) {
  const api = useApi();
  const { getAccessToken } = useAuth();
  const buffer = useRef(new Map<string, Buffered[]>());

  const finishWithDetail = useCallback(
    (executionId: string) => {
      void api
        .get<ExecutionDetail>(`/api/v1/executions/${executionId}`)
        .then((detail) => {
          useEditorStore.getState().applyExecution(detail);
        })
        .catch(() => undefined);
    },
    [api],
  );

  useEffect(() => {
    const socket = executionSocket(getAccessToken);
    const store = () => useEditorStore.getState();
    const pending = buffer.current;

    // Aplica já, se for a execução corrente; senão guarda (o id pode não ter chegado ainda).
    const dispatch = (executionId: string, apply: Buffered) => {
      if (store().run.executionId === executionId) {
        apply(executionId);
        return;
      }
      if (!pending.has(executionId)) {
        if (pending.size >= MAX_BUFFERED_EXECUTIONS)
          pending.delete(pending.keys().next().value ?? '');
        pending.set(executionId, []);
      }
      pending.get(executionId)?.push(apply);
    };
    const onNodeStarted = (e: NodeStartedEvent) => {
      dispatch(e.executionId, () => {
        store().nodeStarted(e.executionId, e.nodeId);
      });
    };
    const onNodeFinished = (e: NodeFinishedEvent) => {
      dispatch(e.executionId, () => {
        store().nodeFinished(e);
      });
    };
    const onFinished = (e: ExecutionFinishedEvent) => {
      dispatch(e.executionId, () => {
        store().runFinished(e);
        finishWithDetail(e.executionId);
        if (e.status === 'success') toast.success('Execução concluída');
        else toast.error('Execução com erro', { description: e.error?.message });
      });
    };
    const joinWorkflow = () => {
      socket.emit('joinWorkflow', { workflowId });
    };

    socket.on('nodeStarted', onNodeStarted);
    socket.on('nodeFinished', onNodeFinished);
    socket.on('executionFinished', onFinished);
    socket.on('connect', joinWorkflow);
    if (socket.connected) joinWorkflow();
    return () => {
      socket.off('nodeStarted', onNodeStarted);
      socket.off('nodeFinished', onNodeFinished);
      socket.off('executionFinished', onFinished);
      socket.off('connect', joinWorkflow);
      socket.emit('leaveWorkflow', { workflowId });
      pending.clear();
    };
  }, [getAccessToken, workflowId, finishWithDetail]);

  return useCallback(
    async (destinationNodeId?: string) => {
      const store = useEditorStore.getState();
      if (store.run.status === 'running') return;
      let executionId: string;
      try {
        ({ executionId } = await api.post<TestRunResponse>(
          `/api/v1/workflows/${workflowId}/test-run`,
          {
            definition: store.definition(),
            ...(destinationNodeId && { destinationNodeId }),
          },
        ));
      } catch (error) {
        if (error instanceof ApiError && error.status === 422) {
          store.setIssues(
            error.issues.map((i) => ({
              code: i.code ?? 'invalid',
              message: i.message,
              nodeIds: i.nodeIds ?? [],
            })),
          );
          toast.error('O workflow tem erros', {
            description: 'Corrija os nós destacados antes de executar.',
          });
        } else if (!(error instanceof ApiError && error.status === 403)) {
          toast.error('Não foi possível executar', {
            description: error instanceof Error ? error.message : undefined,
          });
        }
        return;
      }
      store.setIssues([]);
      store.runStarted(executionId);
      for (const apply of buffer.current.get(executionId) ?? []) apply(executionId);
      buffer.current.delete(executionId);
      // Rede de segurança: sem a sala do workflow (ex.: reconexão), confere pelo log.
      const detail = await api
        .get<ExecutionDetail>(`/api/v1/executions/${executionId}`)
        .catch(() => null);
      if (detail) useEditorStore.getState().applyExecution(detail);
    },
    [api, workflowId],
  );
}
