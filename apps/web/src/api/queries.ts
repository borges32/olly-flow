import type { NodeDescription } from '@olly/nodes';
import type {
  Paginated,
  ProjectMember,
  ProjectSummary,
  UserSummary,
  WorkflowDetail,
  WorkflowSummary,
} from '@olly/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from './api-provider';

export const queryKeys = {
  projects: ['projects'] as const,
  members: (projectId: string) => ['projects', projectId, 'members'] as const,
  workflows: (projectId: string) => ['projects', projectId, 'workflows'] as const,
  workflow: (id: string) => ['workflows', id] as const,
  nodeTypes: ['node-types'] as const,
  users: (search: string) => ['users', search] as const,
};

export function useProjects() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => api.get<ProjectSummary[]>('/api/v1/projects'),
  });
}

export function useMembers(projectId: string | undefined, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.members(projectId ?? ''),
    queryFn: () => api.get<ProjectMember[]>(`/api/v1/projects/${projectId ?? ''}/members`),
    enabled: enabled && projectId !== undefined,
  });
}

export function useWorkflows(projectId: string | undefined, page: number, pageSize = 20) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.workflows(projectId ?? ''), page, pageSize],
    queryFn: () =>
      api.get<Paginated<WorkflowSummary>>(
        `/api/v1/projects/${projectId ?? ''}/workflows?page=${page}&pageSize=${pageSize}`,
      ),
    enabled: projectId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useWorkflow(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.workflow(id),
    queryFn: () => api.get<WorkflowDetail>(`/api/v1/workflows/${id}`),
    // O editor controla quando recarregar; refetch em foco descartaria a edição.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}

export function useNodeTypes() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.nodeTypes,
    queryFn: () => api.get<NodeDescription[]>('/api/v1/node-types'),
    staleTime: Infinity,
  });
}

export function useUserSearch(search: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.users(search),
    queryFn: () => api.get<UserSummary[]>(`/api/v1/users?search=${encodeURIComponent(search)}`),
    enabled,
  });
}
