import type { LoadOptionsSource } from '@olly/nodes';
import type { PostgresColumn } from '@olly/shared-types';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { useApi } from '@/api/api-provider';
import { queryKeys } from '@/api/queries';

/** O que um campo `x-load-options` precisa saber do nó: credencial e parâmetros atuais. */
export interface ParamOptionsSourceContext {
  credentialId?: string;
  params: Record<string, unknown>;
}

export const ParamOptionsContext = createContext<ParamOptionsSourceContext | null>(null);

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Opções do catálogo do banco da credencial do nó (spec 004, FR-016): schemas, tabelas do schema
 * escolhido e colunas da tabela escolhida.
 */
export function useLoadOptions(source: LoadOptionsSource | undefined) {
  const api = useApi();
  const ctx = useContext(ParamOptionsContext);
  const credentialId = ctx?.credentialId;
  const schema = text(ctx?.params.schema) || 'public';
  const table = text(ctx?.params.table);
  const ready =
    source !== undefined &&
    credentialId !== undefined &&
    (source !== 'postgresColumns' || table !== '');
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
  return {
    options: ready ? query.data : undefined,
    loading: ready && query.isLoading,
    error: query.error,
    hint: !credentialId
      ? 'Selecione uma credencial para listar as opções.'
      : source === 'postgresColumns' && !table
        ? 'Escolha a tabela para listar as colunas.'
        : undefined,
  };
}
