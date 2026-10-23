import {
  ollyChatReplyText,
  type OllyChatMessage,
  type OllyChatSession,
  type OllyChatStatus,
} from '@olly/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MessageSquare, Pencil, SquarePen, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { useMe } from '@/api/use-me';
import { useAuth } from '@/auth/auth-provider';
import { chatEntry, type ChatEntry } from '@/chat/chat-entry';
import { readChatStream } from '@/chat/chat-stream';
import { conversationSummary, firstName, groupSessions } from '@/chat/olly-chat-format';
import { OllyAvatar, OllyComposer, OllyEmptyState, OllyMessageList } from '@/chat/olly-chat-view';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const SESSIONS = ['olly-chat', 'sessions'] as const;
const messagesKey = (id: string) => ['olly-chat', 'messages', id] as const;

// FR-005: a resposta guardada antes da correção de 22/10/2026 pode ser o JSON inteiro; a mesma
// leitura do servidor mostra o `report` dela.
const entryOf = (m: OllyChatMessage): ChatEntry => ({
  id: m.id,
  role: m.role === 'user' ? 'user' : m.role === 'error' ? 'error' : 'bot',
  text: (m.role === 'assistant' ? ollyChatReplyText(m.text) : m.text) || '(sem texto)',
  at: m.createdAt,
});

const errorText = async (res: Response): Promise<string> => {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? 'Não foi possível enviar a mensagem';
};

/**
 * Chat da plataforma (spec 028): sessões numeradas na barra lateral e a conversa com o
 * assistente (workflow por webhook em Streaming), com o passo atual enquanto espera.
 */
export function OllyChatPage() {
  const api = useApi();
  const auth = useAuth();
  const me = useMe().data;
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['olly-chat', 'status'],
    queryFn: () => api.get<OllyChatStatus>('/api/v1/olly-chat/status'),
  });
  const sessions = useQuery({
    queryKey: SESSIONS,
    queryFn: () => api.get<OllyChatSession[]>('/api/v1/olly-chat/sessions'),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const current = sessions.data?.find((s) => s.id === selected) ?? sessions.data?.[0] ?? null;
  const messages = useQuery({
    queryKey: messagesKey(current?.id ?? ''),
    queryFn: () =>
      api.get<OllyChatMessage[]>(`/api/v1/olly-chat/sessions/${current?.id ?? ''}/messages`),
    enabled: current !== null,
  });
  const [local, setLocal] = useState<ChatEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [removing, setRemoving] = useState<OllyChatSession | null>(null);
  const creating = useRef(false);

  const refresh = async (sessionId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: SESSIONS }),
      queryClient.invalidateQueries({ queryKey: messagesKey(sessionId) }),
    ]);
  };

  // Uma criação por vez: o clique em "Nova sessão" e a sessão automática não competem.
  const [creatingSession, setCreatingSession] = useState(false);
  const create = useCallback(async () => {
    setCreatingSession(true);
    try {
      const session = await api.post<OllyChatSession>('/api/v1/olly-chat/sessions');
      await queryClient.invalidateQueries({ queryKey: SESSIONS });
      setSelected(session.id);
      setLocal([]);
    } finally {
      setCreatingSession(false);
    }
  }, [api, queryClient]);

  // Primeira visita (HU-2, cenário 5): uma sessão pronta para a primeira mensagem.
  const configured = status.data?.configured === true;
  const empty = sessions.data?.length === 0;
  useEffect(() => {
    if (!configured || !empty || creating.current) return;
    creating.current = true;
    void create().finally(() => {
      creating.current = false;
    });
  }, [configured, empty, create]);

  const send = (text: string) => {
    if (!current) return;
    const sessionId = current.id;
    const question = { ...chatEntry('user', text), at: new Date().toISOString() };
    setLocal([question]);
    setPending(true);
    const token = auth.getAccessToken();
    void fetch(`/api/v1/olly-chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ message: text }),
    })
      .then(async (res) => {
        // Recusada antes de gravar (ex.: sessão ainda respondendo): a pergunta fica só na tela.
        if (!res.ok) return [question, chatEntry('error', await errorText(res))];
        await readChatStream(res, setStep);
        return [];
      })
      .catch(() => [question, chatEntry('error', 'Sem conexão com o chat')])
      .then(async (keep) => {
        await refresh(sessionId);
        setLocal(keep);
        setPending(false);
        setStep(null);
      });
  };

  const rename = async () => {
    if (!editing?.title.trim()) return;
    try {
      await api.patch(`/api/v1/olly-chat/sessions/${editing.id}`, { title: editing.title.trim() });
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: SESSIONS });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Não foi possível renomear');
    }
  };

  const remove = async () => {
    if (!removing) return;
    await api.delete(`/api/v1/olly-chat/sessions/${removing.id}`);
    if (removing.id === current?.id) setSelected(null);
    setRemoving(null);
    await queryClient.invalidateQueries({ queryKey: SESSIONS });
  };

  if (status.data && !status.data.configured) {
    return (
      <div className="grid gap-4" data-testid="olly-chat-unconfigured">
        <PageTitle />
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          O chat ainda não foi configurado. Peça à administração da plataforma para informar o
          webhook do assistente (Administração › Olly Chat).
        </div>
      </div>
    );
  }

  const busy = pending || current?.busy === true;
  const entries = [...(messages.data ?? []).map(entryOf), ...local];
  const loaded = messages.data !== undefined || current === null;
  return (
    // Altura da tela menos o cabeçalho (h-14) e o espaçamento do layout (p-6).
    <div className="flex h-[calc(100dvh-6.5rem)] min-h-[32rem] flex-col gap-4">
      <PageTitle />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border bg-card shadow-sm md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-1">
        <aside
          aria-label="Sessões"
          className="flex max-h-44 min-h-0 flex-col border-b bg-muted/40 md:max-h-none md:border-r md:border-b-0"
        >
          <div className="p-3">
            <Button
              className="w-full justify-start"
              disabled={pending || creatingSession || sessions.data === undefined}
              onClick={() => void create()}
            >
              <SquarePen /> Nova sessão
            </Button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-testid="olly-chat-sessions">
            {groupSessions(sessions.data ?? []).map((group) => (
              <li key={group.label}>
                <p className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {group.sessions.map((s) => (
                    <li key={s.id} className="group">
                      {editing?.id === s.id ? (
                        <form
                          className="flex items-center gap-1 rounded-lg bg-background p-1 ring-1 ring-border"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void rename();
                          }}
                        >
                          <Input
                            autoFocus
                            aria-label="Título da sessão"
                            className="h-7 text-xs"
                            maxLength={120}
                            value={editing.title}
                            onChange={(e) => {
                              setEditing({ id: s.id, title: e.target.value });
                            }}
                          />
                          <Button
                            type="submit"
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-label="Salvar título"
                          >
                            <Check />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-label="Cancelar"
                            onClick={() => {
                              setEditing(null);
                            }}
                          >
                            <X />
                          </Button>
                        </form>
                      ) : (
                        <div
                          className={cn(
                            'flex items-center gap-1 rounded-lg pl-2 text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground',
                            s.id === current?.id &&
                              'bg-background font-medium text-foreground shadow-sm ring-1 ring-border',
                          )}
                        >
                          {s.busy || (pending && s.id === current?.id) ? (
                            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                          ) : (
                            <MessageSquare className="size-3.5 shrink-0" />
                          )}
                          <button
                            type="button"
                            data-testid={`olly-chat-session-${String(s.number)}`}
                            className="min-w-0 flex-1 truncate py-2 pr-1 pl-1 text-left text-sm"
                            title={s.title}
                            disabled={pending}
                            onClick={() => {
                              setSelected(s.id);
                              setLocal([]);
                            }}
                          >
                            {s.title}
                          </button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            aria-label={`Renomear ${s.title}`}
                            onClick={() => {
                              setEditing({ id: s.id, title: s.title });
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          {/* Durante a espera, a sessão não pode ser excluída (FR-007). */}
                          {!pending && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7 opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                              aria-label={`Excluir ${s.title}`}
                              onClick={() => {
                                setRemoving(s);
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </aside>
        <section aria-label="Conversa" className="flex min-h-0 flex-col">
          <header className="flex items-center gap-3 border-b px-5 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold" data-testid="olly-chat-title">
                {current?.title ?? ''}
              </h2>
              <p className="text-xs text-muted-foreground">
                {conversationSummary(
                  entries.filter((e) => e.role !== 'error').length,
                  entries.at(-1)?.at ?? current?.lastMessageAt ?? null,
                )}
              </p>
            </div>
            {busy && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <Loader2 className="size-3 animate-spin" /> Respondendo
              </span>
            )}
          </header>
          {loaded && entries.length === 0 && !busy ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <OllyEmptyState name={firstName(me?.name ?? auth.profileName, me?.email)} />
            </div>
          ) : (
            <OllyMessageList messages={entries} pending={busy} step={step} />
          )}
          <OllyComposer disabled={busy || current === null} onSend={send} />
        </section>
      </div>
      <Dialog
        open={removing !== null}
        onOpenChange={(v) => {
          if (!v) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir a sessão?</DialogTitle>
            <DialogDescription>
              “{removing?.title}” e todas as mensagens dela são removidas. Não há como desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRemoving(null);
              }}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void remove()}>
              <Trash2 /> Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PageTitle() {
  return (
    <div className="flex items-center gap-3">
      <OllyAvatar />
      <div>
        <h1 className="text-xl leading-tight font-semibold tracking-tight">Olly Chat</h1>
        <p className="text-xs text-muted-foreground">Assistente da plataforma</p>
      </div>
    </div>
  );
}
