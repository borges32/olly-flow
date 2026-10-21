-- Spec 027 (FR-006): limite de streams simultâneos (Webhook e chat em "Streaming") do projeto.
-- NULL: vale o padrão da plataforma (OLLY_WEBHOOK_STREAM_MAX_PER_PROJECT).
ALTER TABLE projects
  ADD COLUMN max_webhook_streams INT CHECK (max_webhook_streams > 0);
