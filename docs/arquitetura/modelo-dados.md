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
| `workflows` | Cabeçalho do workflow; `version` = última versão salva | 002 | `published_version`, `active` (005); `error_workflow_id` (007) |
| `workflow_versions` | Definição completa (JSONB) por versão | 002 | Mensagem de versão (009) |
| `webhooks` | Rotas `path` + método → workflow/nó | 002 / 005 | Ativadas na publicação |
| `executions` | Execução de workflow | 003 | **Particionada por mês** (`olly_ensure_partitions`). `project_id` copiado do workflow. `trace_id` (012), `parent_execution_id` (008) |
| `node_executions` | Execução de cada nó (por `run_index`) | 003 | **Particionada por mês**. `input_sources` (origem dos itens, para *paired items*), `pinned`, `reused` (saída reaproveitada de execução anterior, FR-020), `data_truncated`. Dados mascarados na spec 009 |
| `credentials` | Credenciais cifradas por projeto (`data_encrypted` = envelope AES-256-GCM, `key_version` da chave mestra); nome único no projeto | 004 | Ver [docs/credenciais.md](../credenciais.md) |
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
  name TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ                      -- última mudança de nome/e-mail vinda do IdP
);
CREATE TABLE roles (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, permissions TEXT[] NOT NULL);
CREATE TABLE projects (id UUID PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE project_members (
  project_id UUID REFERENCES projects(id), user_id UUID REFERENCES users(id),
  role_id INT REFERENCES roles(id), created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE workflows (
  id UUID PRIMARY KEY, project_id UUID REFERENCES projects(id), name TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,              -- concorrência otimista (spec 002)
  deleted_at TIMESTAMPTZ,                      -- soft delete: as versões permanecem
  created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ
  -- active, published_version: spec 005
);
CREATE TABLE workflow_versions (
  workflow_id UUID REFERENCES workflows(id), version INT, definition JSONB NOT NULL,
  message TEXT, created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (workflow_id, version)
);
CREATE TABLE webhooks (                       -- estrutura na spec 002; uso na 005
  id UUID PRIMARY KEY, workflow_id UUID REFERENCES workflows(id), node_id TEXT NOT NULL,
  method TEXT NOT NULL, path TEXT NOT NULL, active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(), UNIQUE (method, path)
);
CREATE TABLE credentials (                    -- 0005_credentials
  id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
  type TEXT NOT NULL, data_encrypted BYTEA NOT NULL, key_version INT NOT NULL,
  created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE (project_id, name)
);
CREATE TABLE executions (
  id UUID, workflow_id UUID, project_id UUID, workflow_version INT, mode TEXT, trigger_type TEXT,
  triggered_by UUID, status TEXT,            -- queued|running|waiting|success|error|cancelled
  started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ, error JSONB,
  PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);         -- partições mensais: olly_ensure_partitions(meses)
CREATE TABLE node_executions (
  execution_id UUID, node_id TEXT, node_name TEXT, run_index INT, status TEXT, attempts INT,
  pinned BOOLEAN, reused BOOLEAN, started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ, items_in INT, items_out INT,
  input_data JSONB, input_sources JSONB, output_data JSONB, data_truncated BOOLEAN, data_ref TEXT, error JSONB,
  PRIMARY KEY (execution_id, node_id, run_index, started_at)
) PARTITION BY RANGE (started_at);
CREATE TABLE audit_log (                      -- sem FK em user_id: o registro sobrevive a users
  id BIGSERIAL PRIMARY KEY, user_id UUID, action TEXT NOT NULL, entity_type TEXT,
  entity_id TEXT, details JSONB, ip INET, created_at TIMESTAMPTZ DEFAULT now()
);                                            -- triggers bloqueiam UPDATE, DELETE e TRUNCATE
```
