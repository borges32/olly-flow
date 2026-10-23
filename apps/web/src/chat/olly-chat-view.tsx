import { AlertTriangle, ArrowUp, Check, Copy, Sparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChatEntry } from './chat-entry';
import { MessageText } from './chat-view';
import { messageTime } from './olly-chat-format';

/**
 * Visual do Olly Chat (spec 028, FR-013): conversa numa coluna central de leitura, pergunta em
 * balão à direita e resposta como cartão largo (relatórios, tabelas e diagramas).
 */

/** Avatar do assistente. */
export function OllyAvatar({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <div
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-linear-to-br from-primary to-indigo-400 text-white shadow-sm',
        size === 'lg' ? 'size-12' : 'size-8',
      )}
    >
      <Sparkles className={size === 'lg' ? 'size-6' : 'size-4'} />
    </div>
  );
}

/** Boas-vindas numa sessão sem mensagens. */
export function OllyEmptyState({ name }: { name: string }) {
  return (
    <div className="grid h-full place-items-center p-6" data-testid="olly-chat-empty">
      <div className="grid max-w-md justify-items-center gap-3 text-center">
        <OllyAvatar size="lg" />
        <h2 className="text-xl font-semibold tracking-tight">
          {name ? `Olá, ${name}!` : 'Olá!'} Como posso ajudar?
        </h2>
        <p className="text-sm text-muted-foreground">
          Faça uma pergunta. As respostas podem trazer relatórios, tabelas e diagramas, e a conversa
          fica guardada nesta sessão para você continuar depois.
        </p>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-xs text-muted-foreground"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
          },
          () => {
            toast.error('Não foi possível copiar');
          },
        );
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copiado' : 'Copiar'}
    </Button>
  );
}

const Time = ({ at }: { at?: string }) =>
  at ? (
    <time dateTime={at} className="text-[11px] text-muted-foreground">
      {messageTime(at)}
    </time>
  ) : null;

/** Mensagens da conversa, com a espera (passo atual) no fim e rolagem para a última. */
export function OllyMessageList({
  messages,
  pending,
  step,
}: {
  messages: ChatEntry[];
  pending: boolean;
  step: string | null;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending, step]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="chat-messages" aria-live="polite">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-6">
        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="grid justify-items-end gap-1">
                <div
                  data-testid="chat-message-user"
                  className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground shadow-sm break-words md:max-w-[75%]"
                >
                  {m.text}
                </div>
                <Time at={m.at} />
              </div>
            );
          }
          if (m.role === 'error') {
            return (
              <div key={m.id} className="flex gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
                  <AlertTriangle className="size-4" />
                </div>
                <div
                  role="alert"
                  data-testid="chat-message-error"
                  className="min-w-0 flex-1 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                >
                  <MessageText text={m.text} />
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className="group flex gap-3">
              <div className="hidden sm:block">
                <OllyAvatar />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-sm font-semibold">Olly</span>
                  <Time at={m.at} />
                </div>
                <div
                  data-testid="chat-message-bot"
                  className="rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-sm sm:px-5 sm:py-4 leading-relaxed text-card-foreground shadow-sm break-words"
                >
                  <MessageText text={m.text} />
                </div>
                <div className="mt-1 flex opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                  <CopyButton text={m.text} />
                </div>
              </div>
            </div>
          );
        })}
        {pending && (
          <div className="flex gap-3">
            <div className="hidden sm:block">
              <OllyAvatar />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 text-sm font-semibold">Olly</div>
              <div
                data-testid="chat-step"
                className="inline-flex items-center gap-3 rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm"
              >
                <span aria-hidden className="flex gap-1">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="size-1.5 animate-bounce rounded-full bg-primary"
                      style={{ animationDelay: `${String(delay)}ms` }}
                    />
                  ))}
                </span>
                {step ? (
                  <span>
                    Executando: <span className="font-medium text-foreground">{step}</span>…
                  </span>
                ) : (
                  'Pensando…'
                )}
              </div>
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
    </div>
  );
}

/** Campo da mensagem: cresce com o texto; Enter envia, Shift+Enter quebra a linha. */
export function OllyComposer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${String(el.scrollHeight)}px`;
  }, [text]);
  const send = () => {
    if (disabled || !text.trim()) return;
    onSend(text);
    setText('');
  };
  return (
    <div className="border-t bg-background/60 px-4 pt-3 pb-3 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm transition-shadow focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
          <textarea
            ref={input}
            aria-label="Mensagem"
            data-testid="chat-input"
            rows={1}
            className="max-h-48 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Pergunte ao Olly…"
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
            className="size-9 shrink-0 rounded-xl"
            aria-label="Enviar mensagem"
            disabled={disabled || !text.trim()}
            onClick={send}
          >
            <ArrowUp />
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          <kbd className="font-sans font-medium">Enter</kbd> envia ·{' '}
          <kbd className="font-sans font-medium">Shift+Enter</kbd> quebra a linha
        </p>
      </div>
    </div>
  );
}
