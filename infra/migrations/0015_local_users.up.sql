-- Spec 014: usuários locais (e-mail e senha) e sessões locais. A senha só existe como hash
-- (scrypt); a sessão, como hash do token opaco. Origem do usuário: senha local, IdP
-- (external_id) ou os dois (conta vinculada).
ALTER TABLE users
  ADD COLUMN password_hash        TEXT,
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_admin             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN failed_logins        INT     NOT NULL DEFAULT 0,
  ADD COLUMN locked_until         TIMESTAMPTZ;

CREATE TABLE user_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX user_sessions_user ON user_sessions (user_id) WHERE revoked_at IS NULL;
