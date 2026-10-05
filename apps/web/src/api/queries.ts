import type { CredentialTypeDescription, NodeDescription } from '@olly/nodes';
import type {
  CredentialSummary,
  ExecutionDetail,
  ExecutionList,
  Paginated,
  ProjectMember,
  ProjectSummary,
  UserSummary,
  WorkflowDetail,
  WorkflowSummary,
} from '@olly/shared-types';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from './api-provider';

export const queryKeys = {
  projects: ['projects'] as const,
  members: (projectId: string) => ['projects', projectId, 'members'] as const,
  workflows: (projectId: string) => ['projects', projectId, 'workflows'] as const,
  workflow: (id: string) => ['workflows', id] as const,
  nodeTypes: ['node-types'] as const,
  users: (search: string) => ['users', search] as const,
  credentials: (projectId: string) => ['projects', projectId, 'credentials'] as const,
  credentialTypes: ['credential-types'] as const,
  executions: (filters: Record<string, string>) => ['executions', filters] as const,
  execution: (id: string) => ['executions', id] as const,
  postgresOptions: (credentialId: string, source: string, schema = '', table = '') =>
    ['credentials', credentialId, 'postgres', source, schema, table] as const,
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

export function useWorkflow(id: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.workflow(id),
    queryFn: () => api.get<WorkflowDetail>(`/api/v1/workflows/${id}`),
    enabled: enabled && id !== '',
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

/** Credenciais do projeto, sem segredos (spec 004). Exige `credential:use`. */
export function useCredentials(projectId: string | undefined, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.credentials(projectId ?? ''),
    queryFn: () => api.get<CredentialSummary[]>(`/api/v1/projects/${projectId ?? ''}/credentials`),
    enabled: enabled && projectId !== undefined,
  });
}

export function useCredentialTypes() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.credentialTypes,
    queryFn: () => api.get<CredentialTypeDescription[]>('/api/v1/credential-types'),
    staleTime: Infinity,
  });
}

/** Execuções com filtros, paginadas por cursor (spec 005, FR-013). */
export function useExecutions(filters: Record<string, string>) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.executions(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ ...filters, ...(pageParam && { cursor: pageParam }) });
      return api.get<ExecutionList>(`/api/v1/executions?${params.toString()}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useExecution(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.execution(id ?? ''),
    queryFn: () => api.get<ExecutionDetail>(`/api/v1/executions/${id ?? ''}`),
    enabled: id !== undefined,
    refetchOnWindowFocus: false,
  });
}
