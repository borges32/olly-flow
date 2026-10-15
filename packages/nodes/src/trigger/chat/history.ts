import { mapStoredMessagesToChatMessages, type StoredMessage } from '@langchain/core/messages';

/**
 * Histórico da sessão para a ação `loadPreviousSession` (spec 021, FR-006): as mensagens
 * guardadas pela memória, serializadas pelo LangChain, como o N8N devolve (`{ data }`).
 */
export function chatHistory(stored: unknown[]): unknown[] {
  return mapStoredMessagesToChatMessages(stored as StoredMessage[]).map((m) => m.toJSON());
}
