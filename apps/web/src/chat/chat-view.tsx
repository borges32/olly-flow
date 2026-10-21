import { Loader2, Paperclip, SendHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChatEntry } from './chat-entry';
import { MermaidDiagram } from './mermaid-diagram';
import { mermaidSource } from './mermaid-source';

/** Spec 028, FR-012: o GFM traz tabelas, tachado, listas de tarefas e links automáticos. */
const REMARK_PLUGINS = [remarkGfm];

/**
 * Texto da mensagem (spec 021, plan §6): Markdown sem HTML bruto (o `react-markdown` não
 * interpreta HTML por padrão) e links abertos em nova aba, sem acesso à página de origem.
 */
export function MessageText({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      components={{
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
            {children}
          </a>
        ),
        p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
        h1: ({ children }) => (
          <h1 className="mt-3 mb-1 text-lg font-semibold first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mt-3 mb-1 text-base font-semibold first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => <h3 className="mt-2 mb-1 font-semibold first:mt-0">{children}</h3>,
        h4: ({ children }) => <h4 className="mt-2 mb-1 font-medium first:mt-0">{children}</h4>,
        blockquote: ({ children }) => (
          <blockquote className="my-1 border-l-2 border-current/30 pl-3 opacity-90">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-current/20" />,
        // Tabela larga rola dentro da mensagem, sem alargar o balão.
        table: ({ children }) => (
          <div className="my-2 max-w-full overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">{children}</table>
          </div>
        ),
        th: ({ children, style }) => (
          <th
            style={style}
            className="border border-current/20 bg-black/5 px-2 py-1 font-semibold dark:bg-white/10"
          >
            {children}
          </th>
        ),
        td: ({ children, style }) => (
          <td style={style} className="border border-current/20 px-2 py-1 align-top">
            {children}
          </td>
        ),
        code: ({ children }) => (
          <code className="rounded bg-black/10 px-1 font-mono text-[0.85em] dark:bg-white/10">
            {children}
          </code>
        ),
        // Spec 028, FR-011: bloco ```mermaid vira diagrama.
        pre: ({ children, node }) => {
          const mermaid = mermaidSource(node);
          if (mermaid !== null) return <MermaidDiagram code={mermaid} />;
          return (
            <pre className="my-1 overflow-x-auto rounded bg-black/10 p-2 dark:bg-white/10">
              {children}
            </pre>
          );
        },
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
  step,
  testId = 'chat-messages',
}: {
  messages: ChatEntry[];
  pending: boolean;
  /** Spec 027: nó em execução (modo Streaming), no lugar de "Respondendo…". */
  step?: string | null;
  testId?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending, step]);
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
          <div
            data-testid="chat-step"
            className="justify-self-start rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
          >
            <Loader2 className="inline size-4 animate-spin" />{' '}
            {step ? `Executando: ${step}…` : 'Respondendo…'}
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
