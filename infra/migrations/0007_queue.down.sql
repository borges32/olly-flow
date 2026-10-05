ALTER TABLE projects DROP COLUMN max_concurrent_executions;
DROP INDEX executions_running_heartbeat_idx;
ALTER TABLE executions DROP COLUMN heartbeat_at;
DROP TABLE execution_payloads;
