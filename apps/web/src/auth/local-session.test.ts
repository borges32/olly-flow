import { describe, expect, it } from 'vitest';
import { clearSession, readSession, writeSession } from './local-session';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => {
      data.delete(k);
    },
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe('spec 014 — FR-004/FR-007: sessão local no navegador', () => {
  it('FR-004: guarda e lê a sessão; expirada é descartada', () => {
    const storage = memoryStorage();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    writeSession(storage, { token: 'olly_s_abc', expiresAt: future, mustChangePassword: true });
    expect(readSession(storage)).toEqual({
      token: 'olly_s_abc',
      expiresAt: future,
      mustChangePassword: true,
    });
    expect(readSession(storage, Date.now() + 2 * 3_600_000)).toBeNull();
    // Expirada: removida do armazenamento.
    expect(storage.length).toBe(0);
  });

  it('FR-004: sair limpa; conteúdo inválido ou sem armazenamento não quebra', () => {
    const storage = memoryStorage();
    writeSession(storage, {
      token: 'olly_s_x',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mustChangePassword: false,
    });
    clearSession(storage);
    expect(readSession(storage)).toBeNull();
    storage.setItem('olly.session', '{não é json');
    expect(readSession(storage)).toBeNull();
    expect(readSession(undefined)).toBeNull();
  });
});
