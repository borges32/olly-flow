-- Spec 009: governança, SSO institucional, versionamento e LGPD.

-- SSO (FR-005, FR-006): vínculos herdados de grupos do IdP convivem com os manuais.
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
ALTER TABLE project_members ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'
  CHECK (origin IN ('manual', 'idp'));

-- Grupo do IdP → papel. `project_id` NULL = papel em todos os projetos (global).
CREATE TABLE group_role_mappings (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  idp_group  TEXT        NOT NULL,
  project_id UUID        REFERENCES projects (id) ON DELETE CASCADE,
  role_id    INT         NOT NULL REFERENCES roles (id),
  created_by UUID        REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (idp_group, project_id)
);

-- Configurações de governança do projeto (FR-011, FR-012, FR-017, FR-019). `retention` vazio
-- usa os padrões da configuração (OLLY_RETENTION_DATA_DAYS / OLLY_RETENTION_METADATA_DAYS).
ALTER TABLE projects
  ADD COLUMN require_publish_approval BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN executor_can_read_data   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN save_execution_data      TEXT    NOT NULL DEFAULT 'all'
    CHECK (save_execution_data IN ('all', 'errorsOnly', 'none')),
  ADD COLUMN retention                JSONB   NOT NULL DEFAULT '{}'::jsonb;

-- Aprovação de publicação "quatro olhos" (FR-011). O CHECK é a defesa em profundidade da regra
-- autor ≠ aprovador; o índice parcial impede dois pedidos pendentes para o mesmo workflow.
CREATE TABLE publish_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  UUID        NOT NULL REFERENCES workflows (id),
  project_id   UUID        NOT NULL REFERENCES projects (id),
  version      INT         NOT NULL,
  message      TEXT        NOT NULL,
  requested_by UUID        NOT NULL REFERENCES users (id),
  status       TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by   UUID        REFERENCES users (id),
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ,
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE UNIQUE INDEX publish_requests_pending_idx ON publish_requests (workflow_id)
  WHERE status = 'pending';
CREATE INDEX publish_requests_project_status_idx ON publish_requests (project_id, status);

-- Regras de mascaramento (FR-014, FR-016). `builtin`: regra padrão (pode ser desativada, não
-- excluída).
CREATE TABLE masking_rules (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT        NOT NULL CHECK (scope IN ('global', 'project')),
  project_id  UUID        REFERENCES projects (id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL CHECK (kind IN ('field', 'pattern')),
  matcher     TEXT        NOT NULL,
  action      TEXT        NOT NULL CHECK (action IN ('redact', 'partial', 'hash')),
  enabled     BOOLEAN     NOT NULL DEFAULT true,
  builtin     BOOLEAN     NOT NULL DEFAULT false,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((scope = 'global') = (project_id IS NULL))
);
CREATE INDEX masking_rules_project_idx ON masking_rules (project_id);

-- FR-016: regras padrão ativas. E-mail e telefone ficam disponíveis, mas desligados.
INSERT INTO masking_rules (scope, kind, matcher, action, enabled, builtin, description) VALUES
  ('global', 'pattern', 'cpf',             'partial', true,  true, 'CPF (com dígito verificador)'),
  ('global', 'pattern', 'cnpj',            'partial', true,  true, 'CNPJ (com dígito verificador)'),
  ('global', 'pattern', 'card',            'partial', true,  true, 'Cartão de crédito (Luhn)'),
  ('global', 'pattern', 'jwt',             'redact',  true,  true, 'Token JWT'),
  ('global', 'pattern', 'apiKey',          'redact',  true,  true, 'Chaves de API (sk-, AKIA)'),
  ('global', 'field',   '*cpf*',           'partial', true,  true, 'Campos de CPF'),
  ('global', 'field',   '*cnpj*',          'partial', true,  true, 'Campos de CNPJ'),
  ('global', 'field',   '*password*',      'redact',  true,  true, 'Senhas'),
  ('global', 'field',   '*senha*',         'redact',  true,  true, 'Senhas'),
  ('global', 'field',   '*token*',         'redact',  true,  true, 'Tokens'),
  ('global', 'field',   '*authorization*', 'redact',  true,  true, 'Cabeçalho Authorization'),
  ('global', 'field',   '*secret*',        'redact',  true,  true, 'Segredos'),
  ('global', 'pattern', 'email',           'partial', false, true, 'E-mail'),
  ('global', 'pattern', 'phone',           'partial', false, true, 'Telefone (BR)');

-- Execução parcial (spec 003, FR-020) não reaproveita dados alterados pelo mascaramento
-- (FR-015: os dados entre nós nunca são os mascarados).
ALTER TABLE node_executions ADD COLUMN data_masked BOOLEAN NOT NULL DEFAULT false;

-- Cofre (FR-001 a FR-003): provedor da chave mestra que cifrou a DEK; checkpoint da migração.
ALTER TABLE credentials ADD COLUMN key_provider TEXT NOT NULL DEFAULT 'env';
CREATE INDEX credentials_key_idx ON credentials (key_provider, key_version);

-- Consulta da auditoria por ação (FR-018).
CREATE INDEX audit_log_action_idx ON audit_log (action, created_at);
