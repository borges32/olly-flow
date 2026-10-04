-- Spec 004, FR-001: credenciais cifradas (envelope encryption; ver packages/db/src/crypto.ts).
CREATE TABLE credentials (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID        NOT NULL REFERENCES projects (id),
  name           TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  type           TEXT        NOT NULL,
  -- { v, kekVersion, encDek, iv, tag, ciphertext } serializado; nunca sai da API.
  data_encrypted BYTEA       NOT NULL,
  key_version    INT         NOT NULL,
  created_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX credentials_project_idx ON credentials (project_id);
