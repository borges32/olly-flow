import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { chatEntry, type ChatEntry } from '@/chat/chat-entry';
import { ChatComposer, ChatMessageList } from '@/chat/chat-view';
import { useChatTest } from './use-chat-test';

const newSession = () => crypto.randomUUID();

/**
 * Chat do editor (spec 021, FR-002, plan §5), à esquerda dos logs no painel inferior, como no
 * N8N: cada mensagem executa o workflow em modo teste; a conversa mantém o `sessionId` até
 * "Nova sessão". Fica montado com o painel recolhido, para não perder a conversa.
 */
export function ChatColumn({ workflowId }: { workflowId: string }) {
  const send = useChatTest(workflowId);
  const [sessionId, setSessionId] = useState(newSession);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [pending, setPending] = useState(false);

  const onSend = (text: string) => {
    setMessages((m) => [...m, chatEntry('user', text)]);
    setPending(true);
    void send(sessionId, text)
      .then(({ executionId, reply }) => {
        const link = executionId ? (
          <Link to={`/executions/${executionId}`} target="_blank" className="underline">
            Ver execução
          </Link>
        ) : undefined;
        setMessages((m) => [
          ...m,
          chatEntry(
            reply.status === 'success' ? 'bot' : 'error',
            reply.message || '(sem texto)',
            link,
          ),
        ]);
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <section
      aria-label="Chat"
      data-testid="chat-panel"
      className="flex min-h-0 w-[min(28rem,40%)] shrink-0 flex-col border-r"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <h3 className="flex-1 text-sm font-semibold">Chat</h3>
        <span className="text-xs text-muted-foreground" title={sessionId}>
          Sessão <code data-testid="chat-session-id">{sessionId.slice(0, 8)}…</code>
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Nova sessão"
          title="Recomeça a conversa com outra sessão"
          disabled={pending}
          onClick={() => {
            setSessionId(newSession());
            setMessages([]);
          }}
        >
          <RotateCcw />
        </Button>
      </header>
      <ChatMessageList messages={messages} pending={pending} />
      <ChatComposer placeholder="Digite uma mensagem…" disabled={pending} onSend={onSend} />
    </section>
  );
}
