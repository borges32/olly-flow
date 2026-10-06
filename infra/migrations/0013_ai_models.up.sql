-- Spec 011 (FR-002): modelos de IA permitidos na instalação, cadastrados na administração e
-- lidos a cada uso (antes: variável OLLY_ALLOWED_MODELS, que exigia reiniciar a aplicação).
-- Sem semente: a lista começa vazia (negado por padrão).
CREATE TABLE ai_models (
  model       TEXT        PRIMARY KEY CHECK (length(trim(model)) > 0),
  note        TEXT,
  created_by  UUID        REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
