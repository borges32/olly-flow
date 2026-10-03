import type { MeResponse } from '@olly/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-provider';
import { useApi } from './api-provider';

export function useMe() {
  const api = useApi();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['me', user?.profile.sub],
    queryFn: () => api.get<MeResponse>('/api/v1/me'),
    enabled: Boolean(user),
    staleTime: 60_000,
  });
}
