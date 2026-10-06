DROP INDEX executions_waiting_idx;
DROP INDEX executions_parent_idx;
ALTER TABLE executions
  DROP COLUMN retry_of,
  DROP COLUMN depth,
  DROP COLUMN parent_execution_id;
DROP TABLE execution_state;
