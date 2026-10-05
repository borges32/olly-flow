-- Spec 006: fila e workers (FR-001, FR-005, FR-012).

-- Dados do disparo fora da fila: o job leva só o id da execução (FR-001). Sem FK: `executions`
-- é particionada e a chave inclui `started_at`. Acima de 1 MB, o conteúdo vai para o object
-- storage e fica só a referência (`data_ref`).
CREATE TABLE execution_payloads (
  execution_id UUID        PRIMARY KEY,
  data         JSONB,
  data_ref     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (data IS NOT NULL OR data_ref IS NOT NULL)
);

-- Batimento do worker que executa (FR-005): sem batimento recente, `worker_lost`.
ALTER TABLE executions ADD COLUMN heartbeat_at TIMESTAMPTZ;
CREATE INDEX executions_running_heartbeat_idx ON executions (heartbeat_at) WHERE status = 'running';

-- Cota de execuções simultâneas por projeto (FR-012); NULL usa o padrão da configuração.
ALTER TABLE projects ADD COLUMN max_concurrent_executions INT
  CHECK (max_concurrent_executions IS NULL OR max_concurrent_executions > 0);
