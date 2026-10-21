import type { ChatAuthentication, ChatConfig } from '@olly/shared-types';
import { Loader2, MessageCircle, RotateCcw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocation, useParams } from 'react-router';
import { useAuth } from '@/auth/auth-provider';
import { readChatStream } from '@/chat/chat-stream';
import { chatEntry, historyMessage, replyText, type ChatEntry } from '@/chat/chat-entry';
import { ChatComposer, ChatMessageList } from '@/chat/chat-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoginPage } from './login-page';

/** O navegador pode bloquear o armazenamento (janela privada, dados apagados). */
function stored(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}
function store(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Sem armazenamento, a sessão vale só enquanto a página estiver aberta.
  }
}

const sessionKey = (id: string) => `olly-chat-session:${id}`;
const basicKey = (id: string) => `olly-chat-basic:${id}`;
const local = () => window.localStorage;
const session = () => window.sessionStorage;

type Opening =
  | { kind: 'unavailable' }
  | { kind: 'auth'; authentication: ChatAuthentication }
  | { kind: 'ready'; config: ChatConfig; history: ChatEntry[] };

/**
 * Página de chat hospedada (spec 021, FR-003, plan §6): pública, servida pela plataforma para
 * o Chat Trigger publicado. Conversa pelo endereço do N8N (`/webhook/<webhookId>/chat`).
 */
export function ChatPage() {
  const { webhookId = '' } = useParams();
  const location = useLocation();
  const auth = useAuth();
  const endpoint = `/webhook/${encodeURIComponent(webhookId)}/chat`;
  // A sessão aberta com a página (o histórico é dela); "Nova conversa" troca a sessão.
  const [openedSession] = useState(
    () => stored(local, sessionKey(webhookId)) ?? crypto.randomUUID(),
  );
  const [sessionId, setSessionId] = useState(openedSession);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [freshConversation, setFreshConversation] = useState(false);
  const [pending, setPending] = useState(false);
  // Spec 027: nó em execução, com o chat em Streaming.
  const [step, setStep] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [needsLogin, setNeedsLogin] = useState<ChatAuthentication | null>(null);
  const [loginAttempt, setLoginAttempt] = useState(0);

  useEffect(() => {
    store(local, sessionKey(webhookId), sessionId);
  }, [webhookId, sessionId]);

  /** Cabeçalho de autenticação: usuário e senha guardados nesta aba, ou a sessão da plataforma. */
  const authHeaders = useCallback((): Record<string, string> => {
    const basic = stored(session, basicKey(webhookId));
    if (basic) return { authorization: basic };
    const token = auth.getAccessToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  }, [auth, webhookId]);

  const call = useCallback(
    (init: RequestInit): Promise<Response> =>
      fetch(endpoint, {
        ...init,
        headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) },
      }),
    [endpoint, authHeaders],
  );

  const authType = async (res: Response): Promise<ChatAuthentication> =>
    ((await res.json().catch(() => ({}))) as { authentication?: ChatAuthentication })
      .authentication ?? 'basicAuth';

  // Configuração da página e, quando ligada, a conversa anterior desta sessão (FR-006).
  const opening = useQuery({
    queryKey: ['chat-page', webhookId, auth.status, loginAttempt],
    enabled: auth.status !== 'loading',
    retry: false,
    queryFn: async (): Promise<Opening> => {
      const res = await call({ method: 'GET' }).catch(() => null);
      if (res?.status === 401) return { kind: 'auth', authentication: await authType(res) };
      if (!res?.ok) return { kind: 'unavailable' };
      const config = (await res.json()) as ChatConfig;
      if (!config.loadPreviousSession) return { kind: 'ready', config, history: [] };
      const previous = await call({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'loadPreviousSession', sessionId: openedSession }),
      });
      const data = previous.ok
        ? (((await previous.json()) as { data?: unknown[] }).data ?? [])
        : [];
      const history = data.flatMap((m) => {
        const entry = historyMessage(m);
        return entry ? [chatEntry(entry.role, entry.text)] : [];
      });
      return { kind: 'ready', config, history };
    },
  });

  const send = (text: string, files: File[]) => {
    setMessages((m) => [...m, chatEntry('user', text || files.map((f) => f.name).join(', '))]);
    setPending(true);
    const request: RequestInit =
      files.length > 0
        ? (() => {
            const form = new FormData();
            form.append('action', 'sendMessage');
            form.append('sessionId', sessionId);
            form.append('chatInput', text);
            for (const f of files) form.append('files', f, f.name);
            return { method: 'POST', body: form };
          })()
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'sendMessage', sessionId, chatInput: text }),
          };
    const streaming = opening.data?.kind === 'ready' && opening.data.config.streaming;
    void call(request)
      .then(async (res) => {
        if (res.status === 401) {
          setNeedsLogin(await authType(res));
          return;
        }
        if (streaming && res.ok) {
          const result = await readChatStream(res, setStep);
          setMessages((m) => [
            ...m,
            result.ok
              ? chatEntry('bot', replyText(result.body) || '(sem texto)')
              : chatEntry('error', result.message),
          ]);
          return;
        }
        const raw = await res.text();
        let body: unknown = raw;
        try {
          body = JSON.parse(raw) as unknown;
        } catch {
          // Resposta em texto (nó "Responder ao webhook" com texto).
        }
        if (res.ok) {
          setMessages((m) => [...m, chatEntry('bot', replyText(body) || '(sem texto)')]);
          return;
        }
        const message =
          body && typeof body === 'object' && 'message' in body
            ? String(body.message)
            : 'Não foi possível responder agora';
        setMessages((m) => [...m, chatEntry('error', message)]);
      })
      .catch(() => {
        setMessages((m) => [...m, chatEntry('error', 'Sem conexão com o chat')]);
      })
      .finally(() => {
        setPending(false);
        setStep(null);
      });
  };

  const data = opening.data;
  const authentication = needsLogin ?? (data?.kind === 'auth' ? data.authentication : null);
  if (authentication === 'ollyUserAuth' && auth.status !== 'authenticated') {
    return <LoginPage returnTo={location.pathname} />;
  }
  const config = data?.kind === 'ready' ? data.config : null;
  const history = data?.kind === 'ready' && !freshConversation ? data.history : [];
  const initial = config ? config.initialMessages.map((m) => chatEntry('bot', m)) : [];
  const showConversation =
    started || (config !== null && !config.showWelcomeScreen) || history.length > 0;

  return (
    <main className="flex min-h-svh justify-center bg-muted/40 sm:p-6">
      <div className="flex h-svh w-full max-w-2xl flex-col bg-card shadow-sm sm:h-[calc(100svh-3rem)] sm:rounded-lg sm:border">
        {(opening.isPending || auth.status === 'loading') && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="animate-spin" />
          </div>
        )}
        {data?.kind === 'unavailable' && (
          <p
            className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground"
            data-testid="chat-unavailable"
          >
            Este chat não está disponível.
          </p>
        )}
        {authentication === 'ollyUserAuth' && (
          <p className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground">
            Sua sessão não foi aceita por este chat. Entre de novo na plataforma.
          </p>
        )}
        {authentication === 'basicAuth' && (
          <BasicAuthForm
            failed={stored(session, basicKey(webhookId)) !== null}
            onSubmit={(user, password) => {
              store(session, basicKey(webhookId), `Basic ${btoa(`${user}:${password}`)}`);
              setNeedsLogin(null);
              setLoginAttempt((n) => n + 1);
            }}
          />
        )}
        {config && authentication === null && (
          <>
            <header className="flex items-start gap-3 border-b px-4 py-3">
              <MessageCircle className="mt-1 size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-semibold" data-testid="chat-title">
                  {config.title}
                </h1>
                <p className="text-sm text-muted-foreground">{config.subtitle}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                title="Começa uma conversa nova"
                onClick={() => {
                  setSessionId(crypto.randomUUID());
                  setMessages([]);
                  setFreshConversation(true);
                }}
              >
                <RotateCcw /> Nova conversa
              </Button>
            </header>
            {showConversation ? (
              <>
                <ChatMessageList
                  messages={[...initial, ...history, ...messages]}
                  pending={pending}
                  step={step}
                />
                <ChatComposer
                  placeholder={config.inputPlaceholder}
                  disabled={pending}
                  onSend={send}
                  allowFiles={config.allowFileUploads}
                  accept={config.allowedFilesMimeTypes}
                />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
                <p className="text-muted-foreground">{config.subtitle}</p>
                <Button
                  onClick={() => {
                    setStarted(true);
                  }}
                >
                  {config.getStarted}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function BasicAuthForm({
  failed,
  onSubmit,
}: {
  failed: boolean;
  onSubmit: (user: string, password: string) => void;
}) {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(user, password);
  };
  return (
    <form
      onSubmit={submit}
      className="m-auto grid w-full max-w-xs gap-3 p-6"
      data-testid="chat-auth"
    >
      <h1 className="text-lg font-semibold">Entrar no chat</h1>
      {failed && <p className="text-sm text-destructive">Usuário ou senha inválidos.</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="chat-user">Usuário</Label>
        <Input
          id="chat-user"
          value={user}
          onChange={(e) => {
            setUser(e.target.value);
          }}
          autoComplete="username"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="chat-password">Senha</Label>
        <Input
          id="chat-password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          autoComplete="current-password"
        />
      </div>
      <Button type="submit">Entrar</Button>
    </form>
  );
}
