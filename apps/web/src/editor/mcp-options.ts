import type { McpServerOption } from '@olly/shared-types';

export interface McpOptions {
  options: { value: string; label: string }[] | undefined;
  hint: string | undefined;
}

/**
 * Opções dos campos `mcpServers`/`mcpTools` do nó Cliente MCP (spec 010, FR-009) e a orientação
 * quando a lista está vazia: tools são negadas por padrão (FR-002) e só as liberadas aparecem.
 */
export function mcpLoadOptions(
  source: 'mcpServers' | 'mcpTools',
  servers: McpServerOption[] | undefined,
  serverId: string,
): McpOptions {
  if (source === 'mcpServers') {
    return {
      options: servers?.map((s) => ({ value: s.id, label: s.name })),
      hint: servers?.length === 0 ? 'Nenhum servidor MCP aprovado neste projeto.' : undefined,
    };
  }
  if (!serverId)
    return { options: undefined, hint: 'Selecione o servidor MCP para listar as tools.' };
  if (!servers) return { options: undefined, hint: undefined };
  const server = servers.find((s) => s.id === serverId);
  if (!server) {
    return {
      options: [],
      hint: 'O servidor escolhido não está disponível neste projeto (desativado ou removido do catálogo).',
    };
  }
  return {
    options: server.tools.map((t) => ({ value: t.name, label: t.name })),
    hint:
      server.tools.length === 0
        ? 'Nenhuma tool liberada para este projeto. As tools são negadas por padrão: a administração as libera em Administração › MCP (clique no servidor, marque "Liberada" e salve).'
        : undefined,
  };
}
