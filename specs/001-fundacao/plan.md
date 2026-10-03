# Plano técnico — Spec 001: Fundação

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

Monorepo pnpm + Turborepo com API NestJS/Fastify, frontend React/Vite, PostgreSQL via Kysely e Keycloak local. O IdP é acessado apenas pelo protocolo OIDC. O CI roda a verificação completa.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| III — Segurança | JWT validado via JWKS; *password grant* só no realm dev; sem segredos versionados; auditoria imutável |
| IV — Testes | Integração com Testcontainers; E2E de login; teste de migrations |
| VI — Institucional | IdP atrás de configuração OIDC genérica (ADR-0005 pendente) |
| IX — Simplicidade | Somente a stack definida |

## Componentes afetados

| Componente | Mudança |
|---|---|
| raiz | `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, ESLint, Prettier, `.editorconfig`, `.nvmrc`, `docker-compose.yml`, `.env.example`, README |
| `apps/api` | Novo (NestJS) |
| `apps/web` | Novo (React) |
| `apps/worker`, `apps/python-runner`, `apps/task-runner` | Apenas README indicando a spec de origem |
| `packages/shared-types`, `packages/nodes`, `packages/db` | Novos |
| `infra/` | `keycloak/olly-realm.json`, `migrations/` |
| `fixtures/n8n/` | README + exemplo sintético |

## Design

### §1 Monorepo
- Scripts raiz: `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `dev`, `smoke`, `db:migrate`, `db:rollback` e `db:seed`.
- `packageManager` fixado no `package.json` e `.nvmrc` com Node 22.
- ESLint *flat config* com `typescript-eslint` em modo estrito.

### §2 Docker Compose
- Serviços `postgres:16`, `redis:7`, `keycloak` (import do realm no start) e `minio`, todos com healthcheck.
- **Realm `olly`:**
  - client `olly-web` (público, PKCE, redirect `http://localhost:5173/*`) e audience `olly-api`;
  - grupos `admin`, `editor`, `executor` e `viewer`;
  - usuários de teste (senha `olly123`);
  - mapper do claim `groups`;
  - *password grant* habilitado (somente dev).

### §3 `packages/db`
- Kysely + `pg`, com os tipos das tabelas em `src/schema.ts`.
- Migrator Kysely lendo `infra/migrations`.
- `audit_log` com trigger `BEFORE UPDATE OR DELETE` que lança exceção.
- **Seed de papéis** (`docs/arquitetura/contratos.md`):
  - `admin`: todas as permissões;
  - `editor`: todas, exceto `user:manage`, `project:manage` e `audit:read`;
  - `executor`: `workflow:read`, `workflow:execute` e `execution:read`;
  - `viewer`: `workflow:read` e `execution:read`.

  Permissões criadas em specs futuras são acrescentadas ao seed por elas.

### §4 `apps/api`
- Módulos `config` (schema zod do ambiente; falha na inicialização se inválido), `health`, `auth` e `users`.
- `nestjs-pino` com *request id*; *exception filter* global (`DomainError` → HTTP).
- Swagger em `/docs` somente quando `NODE_ENV=development`.
- Prefixo global `/api/v1`, com exclusões conforme `stack.md`.

### §5 Autenticação
- **`AuthGuard` global:** usa `jose.createRemoteJWKSet(OIDC_ISSUER_URL/.well-known → jwks_uri)` e valida `iss`, `aud` (`OIDC_AUDIENCE`) e `exp`. O decorator `@Public()` libera a rota.
- **`UserSyncService`:** faz upsert por `external_id = sub`.
- **`PermissionResolver`:** interface. Nesta spec, a implementação mapeia o claim `groups` para o papel global. A spec 002 substitui pelo RBAC por projeto.
- **Web:** `oidc-client-ts` (`UserManager`), rota `/auth/callback`, `automaticSilentRenew` e logout via `end_session_endpoint`.

### §6 `apps/web`
- Vite + React 18 + Tailwind + shadcn/ui + TanStack Query + React Router.
- Layout com menu lateral (Workflows, Execuções, Credenciais, Administração), cabeçalho com o usuário e tema claro/escuro.
- `apiClient`: injeta o *bearer*; 401 leva ao relogin e 403 mostra um *toast* de acesso negado.

### §7 Contratos e registro de nós
- `packages/shared-types`: tipos de `contratos.md` + `PortDef`, `BinaryRef`, `ExecutionStatus` e `NodeExecutionStatus` + schemas zod de `WorkflowDefinition`.
- `packages/nodes`: `NodeDefinition`, `NodeContext`, `NodeExecuteInput` e `NodeRegistry` (`register`, `get`, `list` sem `execute`). Teste com `ajv` valida o `paramsSchema` de todos os nós registrados.

### §8 CI
- `.github/workflows/ci.yml` com os serviços necessários via Testcontainers (Docker disponível no runner).
- `pnpm audit --audit-level=high` como etapa bloqueante.

### §9 Fixtures e smoke
- `fixtures/n8n/README.md` com o formato: `<caso>/workflow.json`, `input.json`, `expected.json` (saída por nome de nó) e `notes.md`. Exemplo sintético `exemplo-set-if` marcado como sintético.
- `scripts/smoke.ts`:
  1. `GET /health` = 200;
  2. obtém token via *password grant* para `admin@olly.local`;
  3. chama `GET /api/v1/me` e espera 200.

## Modelo de dados

Tabelas `users`, `roles`, `projects`, `project_members` e `audit_log`, conforme [modelo-dados.md](../../docs/arquitetura/modelo-dados.md).

## Contratos

| Método | Rota | Acesso | Saída |
|---|---|---|---|
| GET | `/health` | Público | `{ status, db, redis }` |
| GET | `/api/v1/me` | Autenticado | `{ id, email, name, permissions }` |

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `DATABASE_URL` | — | Conexão PostgreSQL da plataforma |
| `REDIS_URL` | — | Redis |
| `OIDC_ISSUER_URL` | `http://localhost:8080/realms/olly` | Emissor OIDC |
| `OIDC_CLIENT_ID` | `olly-web` | Client do frontend |
| `OIDC_AUDIENCE` | `olly-api` | Audience exigida |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | — | Object storage |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Kysely | Prisma, TypeORM, Drizzle | SQL explícito, bom suporte a SQL puro (partições), tipagem forte |
| `jose` direto | Passport | Menos camadas e controle total da validação |
| Fastify adapter | Express | Desempenho e ecossistema de rate limit/multipart |

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-002, FR-012, FR-017 | Smoke | `pnpm smoke` |
| FR-004, FR-005, FR-006 | Integração | `auth.int.test.ts` |
| FR-007 | E2E | `auth.spec.ts` |
| FR-009 | Integração | `migrations.int.test.ts` (up/down) |
| FR-010 | Integração | `seed.int.test.ts` |
| FR-011 | Integração | `audit-log.int.test.ts` |
| FR-014 | Unidade | `registry.test.ts` |

## Riscos

| Risco | Mitigação |
|---|---|
| IdP institucional indefinido | Configuração OIDC genérica; Keycloak dev |
| Testcontainers lento no CI | Cache de imagens; testes de integração em job separado |
