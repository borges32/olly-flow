DROP INDEX audit_log_action_idx;
DROP INDEX credentials_key_idx;
ALTER TABLE credentials DROP COLUMN key_provider;
ALTER TABLE node_executions DROP COLUMN data_masked;
DROP TABLE masking_rules;
DROP TABLE publish_requests;
ALTER TABLE projects
  DROP COLUMN retention,
  DROP COLUMN save_execution_data,
  DROP COLUMN executor_can_read_data,
  DROP COLUMN require_publish_approval;
DROP TABLE group_role_mappings;
ALTER TABLE project_members DROP COLUMN origin;
ALTER TABLE users DROP COLUMN last_login_at;
