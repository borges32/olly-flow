import type {
  ExecutionDetail,
  ExecutionFinishedEvent,
  NodeFinishedEvent,
  NodeStartedEvent,
  TestRunResponse,
  TestWebhookReceivedEvent,
} from '@olly/shared-types';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { executionSocket } from '@/api/execution-socket';
import { useAuth } from '@/auth/auth-provider';
import { nodeSignatures, planReuse } from './partial-run';
import { useEditorStore } from './store';

type Buffered = (executionId: string) => void;
const MAX_BUFFERED_EXECUTIONS = 20;

/**
 * Execução de teste a partir do editor (FR-011) com acompanhamento em tempo real (FR-012).
 * Com um nó de destino, executa só esse nó (FR-020): os anteriores reaproveitam os dados da
 * última execução quando possível.
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
        store().nodeStarted(e.executionId, e.nodeId, e.startedAt);
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
        else if (e.status === 'cancelled')
          toast.warning('Execução interrompida', { description: e.error?.message });
        else toast.error('Execução com erro', { description: e.error?.message });
      });
    };
    // Spec 005, FR-007: a chamada de teste inicia uma execução que o editor ainda não conhece.
    const onTestWebhook = (e: TestWebhookReceivedEvent) => {
      if (e.workflowId !== workflowId) return;
      const signatures = store().webhookSignatures;
      store().setWebhookListening(null);
      // Execução até o Webhook: mantém o que não depende dele e permite reaproveitá-lo depois.
      store().runStarted(e.executionId, { signatures, destinationNodeId: e.nodeId });
      for (const apply of pending.get(e.executionId) ?? []) apply(e.executionId);
      pending.delete(e.executionId);
      toast.success('Chamada de teste recebida', {
        description: 'Execute os próximos nós pelo botão ▶ de cada nó.',
      });
    };
    const joinWorkflow = () => {
      socket.emit('joinWorkflow', { workflowId });
    };

    socket.on('nodeStarted', onNodeStarted);
    socket.on('nodeFinished', onNodeFinished);
    socket.on('executionFinished', onFinished);
    socket.on('testWebhookReceived', onTestWebhook);
    socket.on('connect', joinWorkflow);
    if (socket.connected) joinWorkflow();
    return () => {
      socket.off('nodeStarted', onNodeStarted);
      socket.off('nodeFinished', onNodeFinished);
      socket.off('executionFinished', onFinished);
      socket.off('testWebhookReceived', onTestWebhook);
      socket.off('connect', joinWorkflow);
      socket.emit('leaveWorkflow', { workflowId });
      pending.clear();
    };
  }, [getAccessToken, workflowId, finishWithDetail]);

  return useCallback(
    async (destinationNodeId?: string) => {
      const store = useEditorStore.getState();
      if (store.run.status === 'running') return;
      const definition = store.definition();
      const pinData = definition.pinData ?? {};
      const signatures = nodeSignatures(definition.nodes, definition.edges, pinData);
      const reuse = destinationNodeId
        ? planReuse(destinationNodeId, definition.nodes, definition.edges, pinData, store.run.nodes)
        : {};
      let executionId: string;
      try {
        ({ executionId } = await api.post<TestRunResponse>(
          `/api/v1/workflows/${workflowId}/test-run`,
          {
            definition,
            ...(destinationNodeId && { destinationNodeId }),
            ...(Object.keys(reuse).length > 0 && { reuse }),
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
      store.runStarted(executionId, {
        signatures,
        ...(destinationNodeId && { destinationNodeId }),
      });
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

/** Spec 006, FR-010: para uma execução na fila ou em andamento. */
export function useCancelExecution() {
  const api = useApi();
  return useCallback(
    async (executionId: string) => {
      try {
        await api.post(`/api/v1/executions/${executionId}/cancel`);
        toast.info('Parando a execução…');
      } catch (error) {
        toast.error('Não foi possível parar a execução', {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [api],
  );
}
