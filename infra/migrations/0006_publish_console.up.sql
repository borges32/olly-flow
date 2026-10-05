-- Spec 005: publicação (FR-001), definição executada (FR-013) e console do nó de código (FR-012).
ALTER TABLE workflows ADD COLUMN published_version INT;
ALTER TABLE workflows ADD COLUMN active BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE executions ADD COLUMN definition JSONB;
ALTER TABLE node_executions ADD COLUMN console JSONB;
