import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/auth-provider';
import { createApiClient, type ApiClient } from './client';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const { getAccessToken, expire } = useAuth();
  const client = useMemo(
    () =>
      createApiClient({
        getAccessToken,
        // Sessão inválida ou expirada: volta à tela de entrada (spec 014).
        onUnauthorized: () => {
          expire();
        },
        onForbidden: (message) => {
          toast.error('Acesso negado', { description: message });
        },
      }),
    [getAccessToken, expire],
  );
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi fora do ApiProvider');
  return ctx;
}
