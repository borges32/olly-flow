ALTER TABLE projects DROP COLUMN monthly_token_limit, DROP COLUMN allowed_models;
DROP TABLE llm_pricing;
DROP TABLE llm_usage;
DROP TABLE approval_requests;
DROP TABLE agent_memory;
DROP TABLE agent_steps;
