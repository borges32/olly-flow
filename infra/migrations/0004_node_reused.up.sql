-- Spec 003, FR-020: nó cuja saída foi reaproveitada de uma execução anterior (execução de um nó).
ALTER TABLE node_executions ADD COLUMN reused BOOLEAN NOT NULL DEFAULT false;
