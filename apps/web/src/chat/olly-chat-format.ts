/** Formatação do Olly Chat (spec 028, FR-013): grupos de sessões por data e horários. */

export type SessionGroupLabel = 'Hoje' | 'Ontem' | 'Últimos 7 dias' | 'Anteriores';

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Dias de calendário entre `iso` e `now` (0 = hoje), no fuso do navegador. */
function daysAgo(iso: string, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY_MS);
}

/**
 * Sessões agrupadas pela última mensagem, na ordem recebida (a API já ordena da mais recente
 * para a mais antiga). Grupos vazios não aparecem.
 */
export function groupSessions<T extends { lastMessageAt: string }>(
  sessions: readonly T[],
  now = new Date(),
): { label: SessionGroupLabel; sessions: T[] }[] {
  const order: SessionGroupLabel[] = ['Hoje', 'Ontem', 'Últimos 7 dias', 'Anteriores'];
  const groups = new Map<SessionGroupLabel, T[]>();
  for (const s of sessions) {
    const days = daysAgo(s.lastMessageAt, now);
    const label: SessionGroupLabel =
      days <= 0 ? 'Hoje' : days === 1 ? 'Ontem' : days < 7 ? 'Últimos 7 dias' : 'Anteriores';
    groups.set(label, [...(groups.get(label) ?? []), s]);
  }
  return order.flatMap((label) => {
    const list = groups.get(label);
    return list ? [{ label, sessions: list }] : [];
  });
}

const two = (n: number) => String(n).padStart(2, '0');

/** Horário da mensagem: "14:05" hoje, "ontem 14:05", senão "21/10 14:05". */
export function messageTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const days = daysAgo(iso, now);
  if (days <= 0) return time;
  if (days === 1) return `ontem ${time}`;
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${time}`;
}

/** Resumo do cabeçalho da conversa: "3 mensagens · última atividade 14:05". */
export function conversationSummary(count: number, lastIso: string | null, now = new Date()) {
  const messages = count === 1 ? '1 mensagem' : `${String(count)} mensagens`;
  if (count === 0 || !lastIso) return 'Nenhuma mensagem ainda';
  return `${messages} · última atividade ${messageTime(lastIso, now)}`;
}

/** Primeiro nome para as boas-vindas ("Alexandre B. Fernandes" → "Alexandre"). */
export function firstName(name: string | null | undefined, email?: string | null): string {
  const fromName = name?.trim().split(/\s+/)[0];
  if (fromName) return fromName.charAt(0).toUpperCase() + fromName.slice(1).toLowerCase();
  return email?.split('@')[0] ?? '';
}
