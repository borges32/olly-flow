-- Spec 008 (parte antecipada para a spec 011, 06/10/2026): estado para retomada, Wait e
-- sub-workflows.

-- Estado serializado do motor de uma execução em `waiting` (FR-012): saídas, índices de
-- execução, `$vars`, laços e os nós que aguardam (com o motivo e os dados próprios de cada um,
-- ex.: o Wait ou a aprovação humana da spec 011). Sem FK: `executions` é particionada. Removido
-- quando a execução termina; dados de execução, tratados como os payloads (spec 006).
CREATE TABLE execution_state (
  execution_id UUID        PRIMARY KEY,
  state        JSONB       NOT NULL,
  -- Próxima retomada por tempo (Wait); NULL quando só uma decisão externa retoma.
  resume_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX execution_state_resume_idx ON execution_state (resume_at) WHERE resume_at IS NOT NULL;

-- Sub-workflows (FR-010): vínculo com a execução pai e profundidade de aninhamento.
-- `retry_of`: reexecução (FR-014, ainda não implementada).
ALTER TABLE executions
  ADD COLUMN parent_execution_id UUID,
  ADD COLUMN depth               INT NOT NULL DEFAULT 0 CHECK (depth >= 0),
  ADD COLUMN retry_of            UUID;
CREATE INDEX executions_parent_idx ON executions (parent_execution_id)
  WHERE parent_execution_id IS NOT NULL;
CREATE INDEX executions_waiting_idx ON executions (status) WHERE status = 'waiting';
