-- Spec 002 (FR-001, FR-002): workflows versionados e rotas de webhook (estrutura; uso na spec 005).

CREATE TABLE workflows (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id),
  name       TEXT NOT NULL,
  -- Última versão salva. A concorrência otimista compara `baseVersion` com esta coluna.
  version    INT  NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workflows_project_id_idx ON workflows (project_id) WHERE deleted_at IS NULL;

CREATE TABLE workflow_versions (
  workflow_id UUID NOT NULL REFERENCES workflows (id),
  version     INT  NOT NULL,
  definition  JSONB NOT NULL,
  message     TEXT,
  created_by  UUID REFERENCES users (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, version)
);

CREATE TABLE webhooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows (id),
  node_id     TEXT NOT NULL,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (method, path)
);
CREATE INDEX webhooks_workflow_id_idx ON webhooks (workflow_id);
