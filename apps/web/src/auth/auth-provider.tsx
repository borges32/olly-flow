import type {
  AuthConfig,
  LocalLoginRequest,
  LocalSessionResponse,
  SetupRequest,
} from '@olly/shared-types';
import type { User } from 'oidc-client-ts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AuthRequestError,
  clearSession,
  readSession,
  writeSession,
  type StoredSession,
} from './local-session';
import { getUserManager } from './oidc';

export interface LoginState {
  returnTo?: string;
}

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  /** Spec 014: cadastro do primeiro usuário pendente e IdP ativado (`GET /auth/config`). */
  config: AuthConfig | null;
  method: 'local' | 'oidc' | null;
  /** Muda a cada sessão (chave de cache das consultas do usuário). */
  sessionKey: string | null;
  /** Sessão local com troca de senha pendente (FR-007). */
  mustChangePassword: boolean;
  /** Nome do perfil do IdP (reserva do cabeçalho se o `/me` falhar). */
  profileName: string | null;
  /** Entrada pelo IdP institucional (redireciona). */
  login: (returnTo?: string) => Promise<void>;
  loginLocal: (input: LocalLoginRequest) => Promise<void>;
  setup: (input: SetupRequest) => Promise<void>;
  logout: () => Promise<void>;
  /** Sessão inválida (401): volta à tela de entrada. */
  expire: () => void;
  passwordChanged: () => void;
  getAccessToken: () => string | undefined;
}

const AuthContext = createContext<AuthState | null>(null);

const storage = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

async function postJson<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new AuthRequestError(payload?.error?.message ?? `Erro ${String(res.status)}`, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/**
 * Sessão do usuário (spec 014, plan §7): local (e-mail e senha, token opaco da API) ou pelo IdP
 * institucional (OIDC), quando ativado na instalação. Os dois entregam um `Bearer` à API.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [local, setLocal] = useState<StoredSession | null>(() => readSession(storage()));
  const [oidcUser, setOidcUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // O que a instalação oferece: primeiro cadastro e IdP.
  useEffect(() => {
    let active = true;
    void fetch('/api/v1/auth/config')
      .then((r) => (r.ok ? (r.json() as Promise<AuthConfig>) : null))
      .catch(() => null)
      .then((c) => {
        if (!active) return;
        setConfig(c ?? { setupRequired: false, idpEnabled: false });
        if (!c?.idpEnabled) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // OIDC só com o IdP ativado (as variáveis VITE_OIDC_* podem nem existir sem ele).
  useEffect(() => {
    if (!config?.idpEnabled) return;
    const manager = getUserManager();
    let active = true;
    void manager.getUser().then((u) => {
      if (!active) return;
      setOidcUser(u && !u.expired ? u : null);
      setLoading(false);
    });
    const onLoaded = (u: User) => {
      setOidcUser(u);
    };
    const onUnloaded = () => {
      setOidcUser(null);
    };
    // Caso de borda da spec 002: se a renovação falhar ou o token expirar, volta ao login.
    const onExpired = () => {
      void manager.removeUser();
    };
    const onRenewError = () => {
      void manager.signinRedirect({
        state: { returnTo: window.location.pathname } satisfies LoginState,
      });
    };
    manager.events.addUserLoaded(onLoaded);
    manager.events.addUserUnloaded(onUnloaded);
    manager.events.addAccessTokenExpired(onExpired);
    manager.events.addSilentRenewError(onRenewError);
    return () => {
      active = false;
      manager.events.removeUserLoaded(onLoaded);
      manager.events.removeUserUnloaded(onUnloaded);
      manager.events.removeAccessTokenExpired(onExpired);
      manager.events.removeSilentRenewError(onRenewError);
    };
  }, [config?.idpEnabled]);

  const startLocal = useCallback((session: LocalSessionResponse) => {
    setLocal(writeSession(storage(), session));
    setConfig((c) => (c ? { ...c, setupRequired: false } : c));
  }, []);

  const login = useCallback(
    (returnTo?: string) =>
      getUserManager().signinRedirect({ state: { returnTo } satisfies LoginState }),
    [],
  );
  const loginLocal = useCallback(
    async (input: LocalLoginRequest) => {
      startLocal(await postJson<LocalSessionResponse>('/api/v1/auth/local/login', input));
    },
    [startLocal],
  );
  const setup = useCallback(
    async (input: SetupRequest) => {
      startLocal(await postJson<LocalSessionResponse>('/api/v1/auth/setup', input));
    },
    [startLocal],
  );
  const expire = useCallback(() => {
    clearSession(storage());
    setLocal(null);
    if (oidcUser) void getUserManager().removeUser();
  }, [oidcUser]);
  const logout = useCallback(async () => {
    if (local) {
      await postJson('/api/v1/auth/logout', {}, local.token).catch(() => undefined);
      clearSession(storage());
      setLocal(null);
      return;
    }
    if (oidcUser) await getUserManager().signoutRedirect();
  }, [local, oidcUser]);
  const passwordChanged = useCallback(() => {
    setLocal((s) => {
      if (!s) return s;
      const next = { ...s, mustChangePassword: false };
      writeSession(storage(), next);
      return next;
    });
  }, []);
  const getAccessToken = useCallback(
    () => local?.token ?? oidcUser?.access_token,
    [local, oidcUser],
  );

  const method = local ? 'local' : oidcUser ? 'oidc' : null;
  const value = useMemo<AuthState>(
    () => ({
      status: loading ? 'loading' : method ? 'authenticated' : 'anonymous',
      config,
      method,
      sessionKey: local ? `local:${local.token.slice(-12)}` : (oidcUser?.profile.sub ?? null),
      mustChangePassword: local?.mustChangePassword ?? false,
      profileName: oidcUser?.profile.name ?? null,
      login,
      loginLocal,
      setup,
      logout,
      expire,
      passwordChanged,
      getAccessToken,
    }),
    [
      loading,
      method,
      config,
      local,
      oidcUser,
      login,
      loginLocal,
      setup,
      logout,
      expire,
      passwordChanged,
      getAccessToken,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
