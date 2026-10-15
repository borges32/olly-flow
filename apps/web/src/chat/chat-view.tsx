import { Loader2, Paperclip, SendHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChatEntry } from './chat-entry';

/**
 * Texto da mensagem (spec 021, plan §6): Markdown sem HTML bruto (o `react-markdown` não
 * interpreta HTML por padrão) e links abertos em nova aba, sem acesso à página de origem.
 */
function MessageText({ text }: { text: string }) {
  return (
    <Markdown
      components={{
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
            {children}
          </a>
        ),
        p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
        code: ({ children }) => (
          <code className="rounded bg-black/10 px-1 font-mono text-[0.85em] dark:bg-white/10">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="my-1 overflow-x-auto rounded bg-black/10 p-2 dark:bg-white/10">
            {children}
          </pre>
        ),
      }}
    >
      {text}
    </Markdown>
  );
}

/** Lista de mensagens com rolagem automática para a última. */
export function ChatMessageList({
  messages,
  pending,
  testId = 'chat-messages',
}: {
  messages: ChatEntry[];
  pending: boolean;
  testId?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid={testId} aria-live="polite">
      <div className="grid gap-2">
        {messages.map((m) => (
          <div
            key={m.id}
            data-testid={`chat-message-${m.role}`}
            className={cn(
              'max-w-[85%] rounded-lg px-3 py-2 text-sm break-words',
              m.role === 'user' && 'justify-self-end bg-primary text-primary-foreground',
              m.role === 'bot' && 'justify-self-start bg-muted',
              m.role === 'error' &&
                'justify-self-start border border-destructive/40 bg-destructive/10 text-destructive',
            )}
          >
            {m.role === 'user' ? (
              <p className="whitespace-pre-wrap">{m.text}</p>
            ) : (
              <MessageText text={m.text} />
            )}
            {m.meta && <div className="mt-1 text-xs opacity-80">{m.meta}</div>}
          </div>
        ))}
        {pending && (
          <div className="justify-self-start rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="inline size-4 animate-spin" /> Respondendo…
          </div>
        )}
        <div ref={end} />
      </div>
    </div>
  );
}

/** Campo da mensagem: Enter envia, Shift+Enter quebra a linha; anexos quando permitidos. */
export function ChatComposer({
  placeholder,
  disabled,
  onSend,
  allowFiles = false,
  accept,
}: {
  placeholder: string;
  disabled: boolean;
  onSend: (text: string, files: File[]) => void;
  allowFiles?: boolean;
  accept?: string;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const send = () => {
    if (disabled || (!text.trim() && files.length === 0)) return;
    onSend(text, files);
    setText('');
    setFiles([]);
  };
  return (
    <div className="grid gap-2 border-t p-3">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Arquivos anexados">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${String(i)}`}
              className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
            >
              {f.name}
              <button
                type="button"
                aria-label={`Remover ${f.name}`}
                onClick={() => {
                  setFiles(files.filter((_, j) => j !== i));
                }}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        {allowFiles && (
          <>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={accept && accept !== '*' ? accept : undefined}
              data-testid="chat-file-input"
              onChange={(e) => {
                setFiles([...files, ...Array.from(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Anexar arquivo"
              disabled={disabled}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip />
            </Button>
          </>
        )}
        <textarea
          aria-label="Mensagem"
          data-testid="chat-input"
          rows={1}
          className="max-h-32 min-h-9 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          aria-label="Enviar mensagem"
          disabled={disabled || (!text.trim() && files.length === 0)}
          onClick={send}
        >
          <SendHorizontal />
        </Button>
      </div>
    </div>
  );
}
