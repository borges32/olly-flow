import type { ChatTestReply, ChatTestStart, ExecutionDetail } from '@olly/shared-types';
import { useCallback } from 'react';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { nodeSignatures } from './partial-run';
import { useEditorStore } from './store';

/**
 * Mensagem do painel de chat (spec 021, FR-002): inicia a execução de teste, liga-a ao estado
 * da execução do editor (status dos nós ao vivo, como o "Executar workflow") e busca a resposta.
 */
export function useChatTest(workflowId: string) {
  const api = useApi();
  return useCallback(
    async (
      sessionId: string,
      chatInput: string,
    ): Promise<{ executionId?: string; reply: ChatTestReply }> => {
      const store = useEditorStore.getState();
      const definition = store.definition();
      const signatures = nodeSignatures(
        definition.nodes,
        definition.edges,
        definition.pinData ?? {},
      );
      let executionId: string;
      try {
        ({ executionId } = await api.post<ChatTestStart>(
          `/api/v1/workflows/${workflowId}/chat/test`,
          { definition, sessionId, chatInput },
        ));
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.issues.map((i) => i.message).join('; ') || error.message
            : 'Não foi possível enviar a mensagem';
        return { reply: { status: 'error', message, error: message } };
      }
      store.runStarted(executionId, { signatures, fromChat: true });
      const reply = await api
        .get<ChatTestReply>(`/api/v1/workflows/${workflowId}/chat/test/${executionId}/reply`)
        .catch((error: unknown): ChatTestReply => ({
          status: 'error',
          message: error instanceof Error ? error.message : 'Sem resposta',
        }));
      // Rede de segurança: os dados finais dos nós vêm do log da execução.
      const detail = await api
        .get<ExecutionDetail>(`/api/v1/executions/${executionId}`)
        .catch(() => null);
      if (detail) useEditorStore.getState().applyExecution(detail);
      return { executionId, reply };
    },
    [api, workflowId],
  );
}
