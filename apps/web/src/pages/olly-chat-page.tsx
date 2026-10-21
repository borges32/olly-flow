import type { OllyChatMessage, OllyChatSession, OllyChatStatus } from '@olly/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MessageSquarePlus, Pencil, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useApi } from '@/api/api-provider';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-provider';
import { chatEntry, type ChatEntry } from '@/chat/chat-entry';
import { readChatStream } from '@/chat/chat-stream';
import { ChatComposer, ChatMessageList } from '@/chat/chat-view';
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

const entryOf = (m: OllyChatMessage): ChatEntry => ({
  id: m.id,
  role: m.role === 'user' ? 'user' : m.role === 'error' ? 'error' : 'bot',
  text: m.text || '(sem texto)',
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
    const question = chatEntry('user', text);
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
      <div className="grid gap-2" data-testid="olly-chat-unconfigured">
        <h1 className="text-2xl font-semibold tracking-tight">Olly Chat</h1>
        <p className="text-muted-foreground">
          O chat ainda não foi configurado. Peça à administração da plataforma para informar o
          webhook do assistente (Administração › Olly Chat).
        </p>
      </div>
    );
  }

  const busy = pending || current?.busy === true;
  const entries = [...(messages.data ?? []).map(entryOf), ...local];
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Olly Chat</h1>
      <div className="grid min-h-[70vh] overflow-hidden rounded-lg border md:grid-cols-[16rem_1fr]">
        <aside
          aria-label="Sessões"
          className="flex max-h-60 flex-col border-b md:max-h-none md:border-r md:border-b-0"
        >
          <div className="border-b p-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={pending || creatingSession || sessions.data === undefined}
              onClick={() => void create()}
            >
              <MessageSquarePlus /> Nova sessão
            </Button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1" data-testid="olly-chat-sessions">
            {sessions.data?.map((s) => (
              <li key={s.id} className="group">
                {editing?.id === s.id ? (
                  <form
                    className="flex items-center gap-1 p-1"
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
                      'flex items-center rounded-md hover:bg-accent',
                      s.id === current?.id && 'bg-accent font-medium',
                    )}
                  >
                    <button
                      type="button"
                      data-testid={`olly-chat-session-${String(s.number)}`}
                      className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
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
                      className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:invisible"
                      aria-label={`Renomear ${s.title}`}
                      onClick={() => {
                        setEditing({ id: s.id, title: s.title });
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:invisible"
                      aria-label={`Excluir ${s.title}`}
                      disabled={pending}
                      onClick={() => {
                        setRemoving(s);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </aside>
        <section aria-label="Conversa" className="flex min-h-[60vh] flex-col">
          <header className="border-b px-3 py-2 text-sm font-medium" data-testid="olly-chat-title">
            {current?.title ?? ''}
          </header>
          <ChatMessageList messages={entries} pending={busy} step={step} />
          <ChatComposer
            placeholder="Digite sua mensagem…"
            disabled={busy || current === null}
            onSend={send}
          />
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
