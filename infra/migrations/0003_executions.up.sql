-- Spec 003 (FR-014, FR-015): log de execuções e de nós, particionado por mês.

CREATE TABLE executions (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  workflow_id      UUID        NOT NULL REFERENCES workflows (id),
  -- Copiado do workflow: autorização de leitura sem depender do estado atual do workflow.
  project_id       UUID        NOT NULL REFERENCES projects (id),
  -- Versão salva em que o teste partiu; a definição testada pode ter alterações não salvas.
  workflow_version INT,
  mode             TEXT        NOT NULL CHECK (mode IN ('test', 'production')),
  trigger_type     TEXT        NOT NULL,
  triggered_by     UUID        REFERENCES users (id),
  status           TEXT        NOT NULL CHECK (status IN ('queued', 'running', 'waiting', 'success', 'error', 'cancelled')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  error            JSONB,
  PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);
CREATE INDEX executions_workflow_idx ON executions (workflow_id, started_at DESC);
CREATE INDEX executions_id_idx ON executions (id);

CREATE TABLE node_executions (
  execution_id   UUID        NOT NULL,
  node_id        TEXT        NOT NULL,
  node_name      TEXT        NOT NULL,
  run_index      INT         NOT NULL DEFAULT 0,
  status         TEXT        NOT NULL CHECK (status IN ('running', 'success', 'error', 'skipped', 'waiting', 'cancelled')),
  attempts       INT         NOT NULL DEFAULT 1,
  pinned         BOOLEAN     NOT NULL DEFAULT false,
  started_at     TIMESTAMPTZ NOT NULL,
  finished_at    TIMESTAMPTZ,
  items_in       INT         NOT NULL DEFAULT 0,
  items_out      INT         NOT NULL DEFAULT 0,
  input_data     JSONB,
  -- Origem de cada item de entrada (nó, porta, índice): reconstrói os paired items no preview.
  input_sources  JSONB,
  output_data    JSONB,
  data_truncated BOOLEAN     NOT NULL DEFAULT false,
  data_ref       TEXT,
  error          JSONB,
  PRIMARY KEY (execution_id, node_id, run_index, started_at)
) PARTITION BY RANGE (started_at);
CREATE INDEX node_executions_execution_idx ON node_executions (execution_id);

-- Cria as partições mensais do mês corrente até `months_ahead` meses à frente. Idempotente;
-- chamada na inicialização da API e periodicamente.
CREATE FUNCTION olly_ensure_partitions(months_ahead INT DEFAULT 2) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  month_start DATE;
  parent TEXT;
BEGIN
  FOR i IN 0..months_ahead LOOP
    month_start := (date_trunc('month', now()) + make_interval(months => i))::date;
    FOREACH parent IN ARRAY ARRAY['executions', 'node_executions'] LOOP
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        parent || '_' || to_char(month_start, 'YYYYMM'),
        parent,
        month_start,
        (month_start + INTERVAL '1 month')::date
      );
    END LOOP;
  END LOOP;
END;
$$;

SELECT olly_ensure_partitions(2);
