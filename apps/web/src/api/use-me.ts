import type { MeResponse } from '@olly/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-provider';
import { useApi } from './api-provider';

export function useMe() {
  const api = useApi();
  const { sessionKey, status } = useAuth();
  return useQuery({
    queryKey: ['me', sessionKey],
    queryFn: () => api.get<MeResponse>('/api/v1/me'),
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });
}
