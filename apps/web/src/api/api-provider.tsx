import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/auth-provider';
import { createApiClient, type ApiClient } from './client';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const { getAccessToken, login } = useAuth();
  const client = useMemo(
    () =>
      createApiClient({
        getAccessToken,
        onUnauthorized: () => {
          void login(window.location.pathname);
        },
        onForbidden: (message) => {
          toast.error('Acesso negado', { description: message });
        },
      }),
    [getAccessToken, login],
  );
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi fora do ApiProvider');
  return ctx;
}
