-- Spec 028: chat da plataforma ("Olly Chat"). Configuração (uma linha), sessões por usuário e
-- mensagens; nome de usuário do IdP (o `login` do payload) e contador de sessões do usuário (o
-- número da sessão nunca é reaproveitado).
CREATE TABLE olly_chat_config (
  id             BOOLEAN     PRIMARY KEY DEFAULT true CHECK (id),
  webhook_url    TEXT,
  retention_days INT         NOT NULL DEFAULT 7 CHECK (retention_days BETWEEN 1 AND 3650),
  auth_type      TEXT        NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'headerAuth', 'basicAuth')),
  -- Segredos da autenticação, criptografados como as credenciais (envelope).
  auth_encrypted BYTEA,
  key_version    INT,
  key_provider   TEXT,
  updated_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE olly_chat_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  number          INT         NOT NULL CHECK (number > 0),
  title           TEXT        NOT NULL,
  title_custom    BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Base da retenção (FR-009): uma mensagem nova renova o prazo.
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, number)
);
CREATE INDEX olly_chat_sessions_user_idx ON olly_chat_sessions (user_id, last_message_at DESC);
CREATE INDEX olly_chat_sessions_retention_idx ON olly_chat_sessions (last_message_at);

CREATE TABLE olly_chat_messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID        NOT NULL REFERENCES olly_chat_sessions (id) ON DELETE CASCADE,
  role         TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'error')),
  text         TEXT        NOT NULL,
  -- `pending`: resposta em andamento (uma mensagem por vez na sessão, FR-007).
  status       TEXT        NOT NULL DEFAULT 'done' CHECK (status IN ('pending', 'done')),
  execution_id UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX olly_chat_messages_session_idx ON olly_chat_messages (session_id, created_at);

ALTER TABLE users
  ADD COLUMN idp_username TEXT,
  ADD COLUMN chat_sessions_created INT NOT NULL DEFAULT 0;
