-- Spec 007 (FR-014): workflow de erro indicado nas configurações do workflow
-- (`settings.errorWorkflowId`), espelhado aqui a cada salvamento para consultas e integridade.
ALTER TABLE workflows ADD COLUMN error_workflow_id UUID REFERENCES workflows (id) ON DELETE SET NULL;
CREATE INDEX workflows_error_workflow_idx ON workflows (error_workflow_id) WHERE error_workflow_id IS NOT NULL;
