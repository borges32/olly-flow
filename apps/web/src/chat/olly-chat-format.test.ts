import { describe, expect, it } from 'vitest';
import { conversationSummary, firstName, groupSessions, messageTime } from './olly-chat-format';

const now = new Date(2026, 9, 23, 15, 30);
const at = (day: number, hour = 10, minute = 5) =>
  new Date(2026, 9, day, hour, minute).toISOString();

describe('spec 028 — FR-013: formatação do Olly Chat', () => {
  it('FR-013: agrupa as sessões por data da última mensagem, mantendo a ordem', () => {
    const sessions = [
      { id: 'a', lastMessageAt: at(23, 9) },
      { id: 'b', lastMessageAt: at(23, 0, 1) },
      { id: 'c', lastMessageAt: at(22, 23, 59) },
      { id: 'd', lastMessageAt: at(17) },
      { id: 'e', lastMessageAt: at(16) },
      { id: 'f', lastMessageAt: at(1) },
    ];
    expect(
      groupSessions(sessions, now).map((g) => [g.label, g.sessions.map((s) => s.id).join('')]),
    ).toEqual([
      ['Hoje', 'ab'],
      ['Ontem', 'c'],
      ['Últimos 7 dias', 'd'],
      ['Anteriores', 'ef'],
    ]);
    expect(groupSessions([{ lastMessageAt: at(1) }], now).map((g) => g.label)).toEqual([
      'Anteriores',
    ]);
    expect(groupSessions([], now)).toEqual([]);
  });

  it('FR-013: horário da mensagem e resumo do cabeçalho', () => {
    expect(messageTime(at(23, 14, 5), now)).toBe('14:05');
    expect(messageTime(at(22, 9, 0), now)).toBe('ontem 09:00');
    expect(messageTime(at(3, 8, 7), now)).toBe('03/10 08:07');
    expect(conversationSummary(0, null, now)).toBe('Nenhuma mensagem ainda');
    expect(conversationSummary(1, at(23, 14, 5), now)).toBe('1 mensagem · última atividade 14:05');
    expect(conversationSummary(4, at(22, 9, 0), now)).toBe(
      '4 mensagens · última atividade ontem 09:00',
    );
  });

  it('FR-013: primeiro nome para as boas-vindas', () => {
    expect(firstName('ALEXANDRE B. FERNANDES')).toBe('Alexandre');
    expect(firstName('  maria  ')).toBe('Maria');
    expect(firstName(null, 'ana.souza@empresa.com')).toBe('ana.souza');
    expect(firstName(undefined)).toBe('');
  });
});
