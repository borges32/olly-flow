# Modelo de Dados (PostgreSQL)

> Visão consolidada das tabelas da plataforma. A definição exata (tipos, índices) fica nas migrations em `infra/migrations/`. Cada spec que cria ou altera uma tabela atualiza este arquivo.

## Tabelas por spec

| Tabela | Finalidade | Spec | Observações |
|---|---|---|---|
| `users` | Usuários vindos do IdP (`external_id` = `sub`) | 001 | Inativação na spec 009 |
| `roles` | Papéis e lista de permissões | 001 | Seed: admin, editor, executor, viewer |
| `projects` | Agrupamento de workflows e credenciais | 001 | `max_concurrent_executions` (006), `require_publish_approval` (009) |
| `project_members` | Usuário + projeto + papel | 001 | Coluna `origin` (`manual` \| `idp`) na spec 009 |
| `audit_log` | Ações de usuários (*append-only*) | 001 | Trigger impede `UPDATE`/`DELETE` |
| `workflows` | Cabeçalho do workflow | 002 | `published_version`, `active` (005); `error_workflow_id` (007) |
| `workflow_versions` | Definição completa (JSONB) por versão | 002 | Mensagem de versão (009) |
| `webhooks` | Rotas `path` + método → workflow/nó | 002 / 005 | Ativadas na publicação |
| `executions` | Execução de workflow | 003 | **Particionada por mês**. `trace_id` (012), `parent_execution_id` (008) |
| `node_executions` | Execução de cada nó (por `run_index`) | 003 | **Particionada por mês**. Dados truncados/mascarados |
| `credentials` | Credenciais cifradas (`data_encrypted`, `key_version`) | 004 | |
| `execution_payloads` | Payload do gatilho para o worker | 006 | Ou object storage se grande |
| `execution_state` | Estado serializado para retomada (`waiting`) | 008 | Usado por Wait e aprovação humana |
| `group_role_mappings` | Grupo do IdP → papel (global ou por projeto) | 009 | |
| `publish_requests` | Pedidos de aprovação de publicação | 009 | |
| `masking_rules` | Regras de mascaramento LGPD | 009 | |
| `mcp_servers` | Catálogo de servidores MCP | 010 | Snapshot de tools |
| `mcp_tool_policies` | Allowlist de tools por servidor e projeto | 010 | `destructive` |
| `mcp_calls` | Log de chamadas MCP | 010 | Argumentos mascarados |
| `agent_steps` | Passos dos agentes | 011 | |
| `agent_memory` | Memória de conversa | 011 | Retenção própria |
| `approval_requests` | Aprovação humana de tools destrutivas | 011 | |
| `llm_usage`, `llm_pricing` | Tokens e custo por execução | 011 | |

## Esboço das tabelas centrais

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY, external_id TEXT UNIQUE, email TEXT UNIQUE NOT NULL,
  name TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE roles (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, permissions TEXT[] NOT NULL);
CREATE TABLE projects (id UUID PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE project_members (
  project_id UUID REFERENCES projects(id), user_id UUID REFERENCES users(id),
  role_id INT REFERENCES roles(id), PRIMARY KEY (project_id, user_id)
);
CREATE TABLE workflows (
  id UUID PRIMARY KEY, project_id UUID REFERENCES projects(id), name TEXT NOT NULL,
  active BOOLEAN DEFAULT false, published_version INT, deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ
);
CREATE TABLE workflow_versions (
  workflow_id UUID REFERENCES workflows(id), version INT, definition JSONB NOT NULL,
  message TEXT, created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (workflow_id, version)
);
CREATE TABLE credentials (
  id UUID PRIMARY KEY, project_id UUID REFERENCES projects(id), name TEXT, type TEXT,
  data_encrypted BYTEA NOT NULL, key_version INT NOT NULL,
  created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ
);
CREATE TABLE executions (
  id UUID, workflow_id UUID, workflow_version INT, mode TEXT, trigger_type TEXT,
  triggered_by UUID, status TEXT,            -- queued|running|waiting|success|error|cancelled
  started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ, error JSONB,
  PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);
CREATE TABLE node_executions (
  execution_id UUID, node_id TEXT, run_index INT, status TEXT, attempts INT,
  started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ, items_in INT, items_out INT,
  input_data JSONB, output_data JSONB, data_ref TEXT, error JSONB,
  PRIMARY KEY (execution_id, node_id, run_index, started_at)
) PARTITION BY RANGE (started_at);
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY, user_id UUID, action TEXT NOT NULL, entity_type TEXT,
  entity_id TEXT, details JSONB, ip INET, created_at TIMESTAMPTZ DEFAULT now()
);
```
