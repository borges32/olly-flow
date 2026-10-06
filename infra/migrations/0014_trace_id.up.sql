-- Spec 012 (FR-001): id do trace OpenTelemetry da execução, para correlação com o coletor.
-- Preenchido só com a telemetria ligada; na tabela-mãe particionada vale para todas as partições.
ALTER TABLE executions ADD COLUMN trace_id TEXT;
