-- Spec 010: cliente MCP governado (catálogo, políticas de tools, snapshot e registro de chamadas).

-- Catálogo (FR-001). `project_id` NULL = servidor global (disponível a todos os projetos).
-- Somente transportes HTTP nesta versão (FR-004, FR-005): o stdio é recusado.
CREATE TABLE mcp_servers (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT        NOT NULL,
  description           TEXT        NOT NULL DEFAULT '',
  transport             TEXT        NOT NULL CHECK (transport IN ('streamableHttp', 'sse')),
  url                   TEXT        NOT NULL,
  -- Credencial da plataforma para o servidor (o nó pode usar a sua, FR-007).
  credential_id         UUID        REFERENCES credentials (id) ON DELETE SET NULL,
  project_id            UUID        REFERENCES projects (id) ON DELETE CASCADE,
  status                TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'disabled')),
  -- FR-003: tools aprovadas ({ nome: { description, inputSchema, hash } }) e a divergência
  -- detectada numa conexão, aguardando revisão.
  tools_snapshot        JSONB,
  snapshot_pending_diff JSONB,
  -- Capacidades e versão do servidor no último teste/aprovação (exibição).
  server_info           JSONB,
  created_by            UUID        REFERENCES users (id) ON DELETE SET NULL,
  approved_by           UUID        REFERENCES users (id) ON DELETE SET NULL,
  approved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (project_id, name)
);

-- Políticas de tool (FR-002): sem registro = negado. A do projeto prevalece sobre a global
-- (`project_id` NULL).
CREATE TABLE mcp_tool_policies (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id   UUID        NOT NULL REFERENCES mcp_servers (id) ON DELETE CASCADE,
  project_id  UUID        REFERENCES projects (id) ON DELETE CASCADE,
  tool_name   TEXT        NOT NULL,
  allowed     BOOLEAN     NOT NULL DEFAULT false,
  destructive BOOLEAN     NOT NULL DEFAULT false,
  updated_by  UUID        REFERENCES users (id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (server_id, project_id, tool_name)
);

-- Registro de cada chamada MCP (FR-011). Sem FK para `executions` (particionada); removido com
-- os metadados da execução pela retenção (spec 009).
CREATE TABLE mcp_calls (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID        NOT NULL,
  project_id   UUID        NOT NULL,
  node_id      TEXT        NOT NULL,
  run_index    INT         NOT NULL DEFAULT 0,
  item_index   INT         NOT NULL DEFAULT 0,
  server_id    UUID        REFERENCES mcp_servers (id) ON DELETE SET NULL,
  server_name  TEXT        NOT NULL,
  operation    TEXT        NOT NULL,
  -- Tool, URI do resource ou nome do prompt (vazio nas listagens).
  target       TEXT,
  arguments    JSONB,
  status       TEXT        NOT NULL CHECK (status IN ('success', 'error', 'denied', 'blocked')),
  duration_ms  INT         NOT NULL DEFAULT 0,
  result_bytes INT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mcp_calls_execution_idx ON mcp_calls (execution_id, created_at);
CREATE INDEX mcp_calls_project_created_idx ON mcp_calls (project_id, created_at);
