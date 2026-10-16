-- Compatibilidade com o PostgreSQL 14.18 (versão de produção; docs/arquitetura/stack.md).
-- As migrations 0009 e 0010 usavam `UNIQUE NULLS NOT DISTINCT` (PostgreSQL 15+) e passaram a
-- criar dois índices únicos parciais com o mesmo efeito. Num banco criado antes dessa mudança,
-- esta migration troca as restrições antigas pelos índices; num banco novo, não faz nada.

ALTER TABLE group_role_mappings DROP CONSTRAINT IF EXISTS group_role_mappings_idp_group_project_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS group_role_mappings_project_uq
  ON group_role_mappings (idp_group, project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS group_role_mappings_global_uq
  ON group_role_mappings (idp_group) WHERE project_id IS NULL;

ALTER TABLE mcp_servers DROP CONSTRAINT IF EXISTS mcp_servers_project_id_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_servers_project_name_uq
  ON mcp_servers (project_id, name) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_servers_global_name_uq
  ON mcp_servers (name) WHERE project_id IS NULL;

ALTER TABLE mcp_tool_policies DROP CONSTRAINT IF EXISTS mcp_tool_policies_server_id_project_id_tool_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tool_policies_project_uq
  ON mcp_tool_policies (server_id, project_id, tool_name) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tool_policies_global_uq
  ON mcp_tool_policies (server_id, tool_name) WHERE project_id IS NULL;
