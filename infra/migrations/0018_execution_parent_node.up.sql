-- Spec 026: nó da execução pai que criou a subexecução ("Executar workflow" ou ferramenta de
-- workflow do Agent), para o log da execução levar à subexecução certa. NULL fora de
-- subexecuções e nas criadas antes desta migration.
ALTER TABLE executions ADD COLUMN parent_node_id TEXT;
