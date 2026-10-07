import type { LocalSessionResponse } from '@olly/shared-types';

/** Sessão local guardada no navegador (spec 014, plan §7). */
export interface StoredSession {
  token: string;
  expiresAt: string;
  mustChangePassword: boolean;
}

const KEY = 'olly.session';

/** Lê a sessão guardada; expirada, inválida ou sem armazenamento: `null`. */
export function readSession(storage: Storage | undefined, now = Date.now()): StoredSession | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'string') return null;
    if (new Date(parsed.expiresAt).getTime() <= now) {
      storage?.removeItem(KEY);
      return null;
    }
    return {
      token: parsed.token,
      expiresAt: parsed.expiresAt,
      mustChangePassword: parsed.mustChangePassword === true,
    };
  } catch {
    return null;
  }
}

export function writeSession(
  storage: Storage | undefined,
  session: LocalSessionResponse,
): StoredSession {
  const stored: StoredSession = {
    token: session.token,
    expiresAt: session.expiresAt,
    mustChangePassword: session.mustChangePassword,
  };
  try {
    storage?.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Sem armazenamento (ex.: modo privado restrito): a sessão vale só nesta página.
  }
  return stored;
}

export function clearSession(storage: Storage | undefined): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nada a limpar.
  }
}

/** Erro de uma chamada de autenticação, com a mensagem da API (ex.: política de senha). */
export class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
