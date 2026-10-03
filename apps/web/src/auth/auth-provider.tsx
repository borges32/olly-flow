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
import { getUserManager } from './oidc';

export interface LoginState {
  returnTo?: string;
}

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: User | null;
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => string | undefined;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const manager = getUserManager();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void manager.getUser().then((u) => {
      if (!active) return;
      setUser(u && !u.expired ? u : null);
      setLoading(false);
    });

    const onLoaded = (u: User) => {
      setUser(u);
    };
    const onUnloaded = () => {
      setUser(null);
    };
    // Caso de borda da spec: se a renovação silenciosa falhar ou o token expirar, volta ao login.
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
  }, [manager]);

  const login = useCallback(
    (returnTo?: string) => manager.signinRedirect({ state: { returnTo } satisfies LoginState }),
    [manager],
  );
  const logout = useCallback(() => manager.signoutRedirect(), [manager]);
  const getAccessToken = useCallback(() => user?.access_token, [user]);

  const value = useMemo<AuthState>(
    () => ({
      status: loading ? 'loading' : user ? 'authenticated' : 'anonymous',
      user,
      login,
      logout,
      getAccessToken,
    }),
    [loading, user, login, logout, getAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
