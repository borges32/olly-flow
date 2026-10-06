import type { CredentialTypeDescription, NodeDescription } from '@olly/nodes';
import type {
  AuditList,
  CredentialSummary,
  GroupRoleMapping,
  MaskingRule,
  ProjectSettings,
  PublishApproval,
  UserAdminSummary,
  WorkflowVersionSummary,
  ExecutionDetail,
  ExecutionList,
  Paginated,
  ProjectMember,
  ProjectSummary,
  QueueStats,
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
  queueStats: (projectId: string) => ['projects', projectId, 'queue-stats'] as const,
  // Spec 009.
  projectSettings: (projectId: string) => ['projects', projectId, 'settings'] as const,
  versions: (workflowId: string) => ['workflows', workflowId, 'versions'] as const,
  publishRequests: (filters: Record<string, string>) => ['publish-requests', filters] as const,
  groupMappings: ['sso', 'group-mappings'] as const,
  adminUsers: ['admin', 'users'] as const,
  maskingRules: (projectId: string | null) => ['masking-rules', projectId ?? 'global'] as const,
  audit: (filters: Record<string, string>) => ['audit', filters] as const,
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
    // Spec 006: enquanto houver execução na fila ou em andamento, atualiza a lista.
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) =>
        p.items.some((i) => i.status === 'queued' || i.status === 'running'),
      )
        ? 2000
        : false,
  });
}

export function useExecution(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.execution(id ?? ''),
    queryFn: () => api.get<ExecutionDetail>(`/api/v1/executions/${id ?? ''}`),
    enabled: id !== undefined,
    refetchOnWindowFocus: false,
    // Spec 006: execução na fila ou em andamento é acompanhada até terminar.
    refetchInterval: (query) =>
      ['queued', 'running'].includes(query.state.data?.status ?? '') ? 1000 : false,
  });
}

/** Spec 006, FR-012: execuções do projeto em andamento, na fila e a cota. */
export function useQueueStats(projectId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.queueStats(projectId ?? ''),
    queryFn: () => api.get<QueueStats>(`/api/v1/projects/${projectId ?? ''}/queue-stats`),
    enabled: projectId !== undefined,
    refetchInterval: 3000,
  });
}

/** Spec 009: governança do projeto (aprovação, dados, retenção). */
export function useProjectSettings(projectId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.projectSettings(projectId ?? ''),
    queryFn: () => api.get<ProjectSettings>(`/api/v1/projects/${projectId ?? ''}/settings`),
    enabled: projectId !== undefined,
  });
}

/** Spec 009, FR-008: histórico de versões do workflow. */
export function useVersions(workflowId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.versions(workflowId),
    queryFn: () => api.get<WorkflowVersionSummary[]>(`/api/v1/workflows/${workflowId}/versions`),
    enabled,
  });
}

/** Spec 009, FR-011: pedidos de publicação (o menu consulta os pendentes). */
export function usePublishRequests(filters: Record<string, string>, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.publishRequests(filters),
    queryFn: () =>
      api.get<PublishApproval[]>(
        `/api/v1/publish-requests?${new URLSearchParams(filters).toString()}`,
      ),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useGroupMappings() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.groupMappings,
    queryFn: () => api.get<GroupRoleMapping[]>('/api/v1/sso/group-mappings'),
  });
}

export function useAdminUsers() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.adminUsers,
    queryFn: () => api.get<UserAdminSummary[]>('/api/v1/admin/users'),
  });
}

/** Regras globais (`null`) ou as que valem no projeto. */
export function useMaskingRules(projectId: string | null, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.maskingRules(projectId),
    queryFn: () =>
      api.get<MaskingRule[]>(
        projectId ? `/api/v1/projects/${projectId}/masking-rules` : '/api/v1/masking-rules',
      ),
    enabled,
  });
}

/** Spec 009, FR-018: auditoria paginada por cursor. */
export function useAudit(filters: Record<string, string>) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.audit(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ ...filters, ...(pageParam && { cursor: pageParam }) });
      return api.get<AuditList>(`/api/v1/audit?${params.toString()}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
