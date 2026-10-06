import type { LoadOptionsSource } from '@olly/nodes';
import type {
  McpToolDefinition,
  Paginated,
  PostgresColumn,
  WorkflowSummary,
} from '@olly/shared-types';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { useApi } from '@/api/api-provider';
import { queryKeys, useMcpAvailable } from '@/api/queries';
import { mcpLoadOptions } from './mcp-options';

/** O que um campo `x-load-options` precisa saber do nó: credencial, projeto e parâmetros. */
export interface ParamOptionsSourceContext {
  credentialId?: string;
  /** Projeto do workflow (spec 010: servidores MCP disponíveis). */
  projectId?: string;
  params: Record<string, unknown>;
}

export const ParamOptionsContext = createContext<ParamOptionsSourceContext | null>(null);

/** Opção de um select dinâmico: o valor gravado e o rótulo exibido. */
export interface LoadedOption {
  value: string;
  label: string;
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const POSTGRES: readonly string[] = ['postgresSchemas', 'postgresTables', 'postgresColumns'];

/**
 * Opções de campos `x-load-options`: catálogo do banco da credencial do nó (spec 004, FR-016) ou
 * servidores e tools MCP liberados no projeto (spec 010, FR-009).
 */
export function useLoadOptions(source: LoadOptionsSource | undefined) {
  const api = useApi();
  const ctx = useContext(ParamOptionsContext);
  const credentialId = ctx?.credentialId;
  const schema = text(ctx?.params.schema) || 'public';
  const table = text(ctx?.params.table);
  const isPostgres = source !== undefined && POSTGRES.includes(source);
  const isMcp = source === 'mcpServers' || source === 'mcpTools';
  const ready =
    isPostgres && credentialId !== undefined && (source !== 'postgresColumns' || table !== '');
  const base = `/api/v1/credentials/${credentialId ?? ''}/postgres`;
  const query = useQuery({
    queryKey: queryKeys.postgresOptions(credentialId ?? '', source ?? '', schema, table),
    queryFn: async (): Promise<string[]> => {
      if (source === 'postgresSchemas') return api.get<string[]>(`${base}/schemas`);
      if (source === 'postgresTables')
        return api.get<string[]>(`${base}/tables?schema=${encodeURIComponent(schema)}`);
      const columns = await api.get<PostgresColumn[]>(
        `${base}/columns?schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`,
      );
      return columns.map((c) => c.name);
    },
    enabled: ready,
    retry: false,
    staleTime: 60_000,
  });
  const mcp = useMcpAvailable(isMcp ? ctx?.projectId : undefined);
  // Spec 008: workflows do projeto para o sub-workflow (a execução exige o alvo publicado).
  const workflows = useQuery({
    queryKey: ['projects', ctx?.projectId ?? '', 'workflows', 'options'],
    queryFn: () =>
      api.get<Paginated<WorkflowSummary>>(
        `/api/v1/projects/${ctx?.projectId ?? ''}/workflows?page=1&pageSize=100`,
      ),
    enabled: source === 'workflows' && ctx?.projectId !== undefined,
    staleTime: 30_000,
  });
  // Spec 011, FR-002: modelos permitidos no projeto (instalação ∩ projeto).
  const models = useQuery({
    queryKey: ['projects', ctx?.projectId ?? '', 'ai-models'],
    queryFn: () => api.get<string[]>(`/api/v1/projects/${ctx?.projectId ?? ''}/ai-models`),
    enabled: source === 'aiModels' && ctx?.projectId !== undefined,
    retry: false,
    staleTime: 60_000,
  });
  if (source === 'aiModels') {
    return {
      options: models.data?.map((value) => ({ value, label: value })),
      loading: models.isLoading,
      error: models.error,
      hint: 'Nenhum modelo liberado: a administração cadastra os modelos em Administração › IA.',
    };
  }
  if (source === 'workflows') {
    return {
      options: workflows.data?.items.map((w) => ({ value: w.id, label: w.name })),
      loading: workflows.isLoading,
      error: workflows.error,
      hint: 'Publique o workflow chamado; ele precisa do gatilho "Quando chamado por outro workflow".',
    };
  }

  if (isMcp) {
    const { options, hint } = mcpLoadOptions(source, mcp.data, text(ctx?.params.serverId));
    return { options, loading: mcp.isLoading, error: mcp.error, hint };
  }
  return {
    options: ready ? query.data?.map((value) => ({ value, label: value })) : undefined,
    loading: ready && query.isLoading,
    error: query.error,
    hint: !credentialId
      ? 'Selecione uma credencial para listar as opções.'
      : source === 'postgresColumns' && !table
        ? 'Escolha a tabela para listar as colunas.'
        : undefined,
  };
}

/** Tool MCP escolhida no nó, com o schema aprovado (formulário de argumentos, FR-009). */
export function useMcpToolSchema(): {
  tool: McpToolDefinition | undefined;
  loading: boolean;
  hint: string | undefined;
} {
  const ctx = useContext(ParamOptionsContext);
  const serverId = text(ctx?.params.serverId);
  const toolName = text(ctx?.params.toolName);
  const { data, isLoading } = useMcpAvailable(ctx?.projectId);
  const tool = data?.find((s) => s.id === serverId)?.tools.find((t) => t.name === toolName);
  return {
    tool,
    loading: isLoading,
    hint: !serverId
      ? 'Selecione o servidor MCP.'
      : !toolName
        ? 'Selecione a tool para preencher os argumentos.'
        : !tool && !isLoading
          ? 'Tool não liberada para este projeto (ou alterada desde a aprovação).'
          : undefined,
  };
}
