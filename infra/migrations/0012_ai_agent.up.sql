-- Spec 011: AI Agent (passos, memória, aprovação humana, uso e custo de LLM).

-- Passos do agente (FR-006): cada chamada ao modelo, ferramenta, aprovação e resposta final,
-- com o conteúdo mascarado. Sem FK para `executions` (particionada); retenção com os metadados.
CREATE TABLE agent_steps (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id  UUID        NOT NULL,
  project_id    UUID        NOT NULL,
  node_id       TEXT        NOT NULL,
  run_index     INT         NOT NULL DEFAULT 0,
  item_index    INT         NOT NULL DEFAULT 0,
  step_index    INT         NOT NULL,
  kind          TEXT        NOT NULL CHECK (kind IN ('model', 'tool', 'approval', 'final', 'error')),
  tool_name     TEXT,
  content       JSONB,
  input_tokens  INT,
  output_tokens INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_steps_execution_idx ON agent_steps (execution_id, created_at);
CREATE INDEX agent_steps_project_created_idx ON agent_steps (project_id, created_at);

-- Memória persistente de conversa (FR-009), isolada por projeto e chave de sessão.
CREATE TABLE agent_memory (
  id          BIGSERIAL   PRIMARY KEY,
  project_id  UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  session_key TEXT        NOT NULL,
  -- Mensagem no formato armazenável do LangChain (`StoredMessage`).
  message     JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_memory_session_idx ON agent_memory (project_id, session_key, id);
CREATE INDEX agent_memory_created_idx ON agent_memory (created_at);

-- Aprovação humana de ferramentas destrutivas (FR-010, FR-011). Os argumentos guardados aqui
-- são só para exibição (mascarados); a execução usa os originais do estado salvo (spec 008).
CREATE TABLE approval_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID        NOT NULL,
  project_id   UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  workflow_id  UUID        NOT NULL,
  node_id      TEXT        NOT NULL,
  run_index    INT         NOT NULL DEFAULT 0,
  item_index   INT         NOT NULL DEFAULT 0,
  approval_key TEXT        NOT NULL,
  tool         TEXT        NOT NULL,
  arguments    JSONB,
  reason       TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  expires_at   TIMESTAMPTZ NOT NULL,
  decided_by   UUID        REFERENCES users (id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (execution_id, node_id, run_index, approval_key)
);
CREATE INDEX approval_requests_pending_idx ON approval_requests (project_id, status, created_at);
CREATE INDEX approval_requests_expiry_idx ON approval_requests (expires_at) WHERE status = 'pending';

-- Uso de LLM por chamada ao modelo (FR-014): tokens e custo estimado pelo preço do momento.
CREATE TABLE llm_usage (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id  UUID          NOT NULL,
  project_id    UUID          NOT NULL,
  workflow_id   UUID          NOT NULL,
  node_id       TEXT          NOT NULL,
  provider      TEXT          NOT NULL,
  model         TEXT          NOT NULL,
  input_tokens  INT           NOT NULL DEFAULT 0,
  output_tokens INT           NOT NULL DEFAULT 0,
  -- NULL quando o modelo não tem preço cadastrado.
  cost_estimate NUMERIC(14, 6),
  currency      TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX llm_usage_execution_idx ON llm_usage (execution_id);
CREATE INDEX llm_usage_project_created_idx ON llm_usage (project_id, created_at);
CREATE INDEX llm_usage_workflow_created_idx ON llm_usage (workflow_id, created_at);

-- Tabela de preços (FR-014), por milhão de tokens, editável pela administração. Semeada com os
-- preços públicos dos provedores da ADR-0008 consultados em 06/10/2026 (valores de referência).
CREATE TABLE llm_pricing (
  model         TEXT          PRIMARY KEY,
  provider      TEXT          NOT NULL,
  input_per_1m  NUMERIC(12, 4) NOT NULL CHECK (input_per_1m >= 0),
  output_per_1m NUMERIC(12, 4) NOT NULL CHECK (output_per_1m >= 0),
  currency      TEXT          NOT NULL DEFAULT 'USD',
  note          TEXT,
  updated_by    UUID          REFERENCES users (id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
INSERT INTO llm_pricing (model, provider, input_per_1m, output_per_1m, note) VALUES
  ('gpt-6.1-sol',            'openai',    2.00, 10.00, 'Preço público em 06/10/2026'),
  ('gpt-6-luna',             'openai',    0.10,  0.50, 'Preço público em 06/10/2026'),
  ('gpt-5.6-terra',          'openai',    2.00, 12.00, 'Preço público em 06/10/2026'),
  ('gpt-5.6-luna',           'openai',    0.20,  1.20, 'Preço público em 06/10/2026'),
  ('gpt-5',                  'openai',    1.25, 10.00, 'Preço público em 06/10/2026'),
  ('gpt-5-mini',             'openai',    0.25,  2.00, 'Preço público em 06/10/2026'),
  ('gpt-4.1',                'openai',    2.00,  8.00, 'Preço público em 06/10/2026'),
  ('gpt-4.1-mini',           'openai',    0.40,  1.60, 'Preço público em 06/10/2026'),
  ('gpt-4o',                 'openai',    2.50, 10.00, 'Preço público em 06/10/2026'),
  ('gpt-4o-mini',            'openai',    0.15,  0.60, 'Preço público em 06/10/2026'),
  ('claude-fable-5-1',       'anthropic', 10.00, 50.00, 'Preço público em 06/10/2026'),
  ('claude-opus-5-5',        'anthropic',  4.00, 20.00, 'Preço público em 06/10/2026'),
  ('claude-sonnet-5-5',      'anthropic',  2.00, 10.00, 'Preço público em 06/10/2026'),
  ('claude-sonnet-4-5',      'anthropic',  3.00, 15.00, 'Preço público em 06/10/2026'),
  ('claude-haiku-4-5',       'anthropic',  1.00,  5.00, 'Preço público em 06/10/2026'),
  ('gemini-3.8-flash',       'google',    0.75,  3.75, 'Preço promocional até 31/12/2026 (dobra em 2027)'),
  ('gemini-3.7-flash',       'google',    0.75,  3.75, 'Preço promocional até 31/12/2026 (dobra em 2027)'),
  ('gemini-2.5-pro',         'google',    1.25, 10.00, 'Preço público em 06/10/2026 (até 200 mil tokens)'),
  ('gemini-2.5-flash',       'google',    0.30,  2.50, 'Preço público em 06/10/2026'),
  ('gemini-2.5-flash-lite',  'google',    0.10,  0.40, 'Preço público em 06/10/2026');

-- Modelos permitidos no projeto (FR-002; NULL = os da instalação) e limite mensal de tokens
-- (FR-015; NULL = sem limite, decisão de 06/10/2026).
ALTER TABLE projects
  ADD COLUMN allowed_models      TEXT[],
  ADD COLUMN monthly_token_limit BIGINT CHECK (monthly_token_limit IS NULL OR monthly_token_limit > 0);
