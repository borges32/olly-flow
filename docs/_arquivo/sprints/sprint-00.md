# Sprint 0 — Fundação

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Depois leia `docs/decisoes.md` e `docs/analise_implementacao.md`.

## Pré-requisitos

- **Humanos:** ADRs 002, 003 e 004 confirmadas em `docs/decisoes.md`. Se ainda estiverem como `Proposta`, siga-as mesmo assim.
- **Humanos (desejável):** workflows de referência da POC exportados em `fixtures/n8n/` (veja a tarefa T10). Se não existirem, crie apenas a estrutura.
- **Técnicos:** o repositório contém apenas `docs/`. Esta é a primeira sprint.

## Contexto

Esta sprint cria a base técnica do projeto. Ao final, a equipe e os próximos prompts devem poder entregar apenas funcionalidades, sem retrabalho de infraestrutura.

## Objetivo

Ter um monorepo funcional, com API e frontend, autenticação OIDC, banco com migrations, contratos centrais definidos, CI e ambiente local subindo com um comando.

## Tarefas

### T1 — Monorepo
- `package.json` raiz com pnpm workspaces e Turborepo, contendo os scripts `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `dev` e `smoke`.
- `tsconfig.base.json` com `strict: true`, ESLint (flat config) com regras TypeScript, Prettier e `.editorconfig`.
- Crie os workspaces vazios da seção 3 do contexto global. `apps/worker` e `apps/python-runner` ficam só com um README que diz "Sprint 5" / "Sprint 7".
- `.nvmrc` com Node 22 e `packageManager` fixado no `package.json`.

### T2 — Docker Compose de desenvolvimento
- Serviços: `postgres` (16), `redis` (7), `keycloak` (importando o realm de `infra/keycloak/olly-realm.json`) e `minio`.
- O realm de dev tem os clients `olly-web` (público, PKCE) e `olly-api` (audience), e os usuários de teste `admin@olly.local`, `editor@olly.local`, `executor@olly.local` e `viewer@olly.local` (senha `olly123`), cada um em um grupo com o nome do papel.
- Healthchecks em todos os serviços.
- `.env.example` com todas as variáveis.

### T3 — `packages/db`
- Cliente Kysely configurado por variável de ambiente e tipos das tabelas.
- Runner de migrations (`pnpm db:migrate`, `pnpm db:rollback`).
- Migrations iniciais, conforme a seção 10 de `analise_implementacao.md`: `users`, `roles`, `projects`, `project_members` e `audit_log` (append-only; crie uma *rule* ou *trigger* que impeça `UPDATE` e `DELETE`).
- Seed (`pnpm db:seed`) com os 4 papéis e suas permissões, conforme a matriz da seção 7.2 da análise:
  - `admin`: todas as permissões;
  - `editor`: tudo, exceto `user:manage`, `project:manage` e `audit:read`;
  - `executor`: `workflow:read`, `workflow:execute` e `execution:read`;
  - `viewer`: `workflow:read` e `execution:read`.

### T4 — `apps/api` (NestJS + Fastify)
- Módulos: `config` (validação zod do ambiente), `health` (`GET /health` com status de DB e Redis), `auth` e `users`.
- `nestjs-pino` com *request id*; *exception filter* global mapeando erros de domínio para HTTP.
- OpenAPI/Swagger em `/docs`, disponível apenas em desenvolvimento.
- Prefixo `/api/v1` em todas as rotas, exceto `/health` e, no futuro, `/webhook`.

### T5 — Autenticação OIDC
- **API:** guard global que valida o JWT (assinatura via JWKS, `iss`, `aud`, `exp`). Rotas públicas usam o decorator `@Public()`.
- **Primeiro login:** cria ou atualiza o usuário em `users` (`external_id` = `sub`, email, nome).
- `GET /api/v1/me` retorna o usuário e as permissões efetivas. O cálculo de permissões deve ficar atrás de uma interface, pois o RBAC completo chega na Sprint 1. Nesta sprint, mapeie o grupo do token para o papel.
- **Web:** `oidc-client-ts` com PKCE, rota de callback, renovação silenciosa de token e logout.
- O provedor de identidade é acessado apenas via configuração OIDC (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`), sem código específico do Keycloak (ADR-005 pendente).

### T6 — `apps/web`
- Vite + React + TypeScript + Tailwind + shadcn/ui + TanStack Query + React Router.
- Layout com menu lateral (Workflows, Execuções, Credenciais, Administração), cabeçalho com o usuário logado e tema claro/escuro.
- Cliente HTTP que injeta o token e trata 401 (relogin) e 403 (mensagem de acesso negado).
- Página inicial "Workflows" vazia.

### T7 — `packages/shared-types`
- Tipos da seção 4 do contexto global, mais `PortDef`, `WorkflowSettings`, `BinaryRef`, `ExecutionStatus` e `NodeExecutionStatus`.
- Schemas zod equivalentes para `WorkflowDefinition` (serão usados para validar o que vem da API).

### T8 — `packages/nodes`: contrato e registro
- Interface `NodeDefinition`, `NodeContext` e `NodeExecuteInput`.
- `NodeRegistry` com `register()`, `get(type)` e `list()` (metadados sem a função `execute`, para expor ao frontend).
- Teste que valida que todo nó registrado tem um `paramsSchema` JSON Schema válido (use `ajv`).

### T9 — CI
- Pipeline (GitHub Actions em `.github/workflows/ci.yml`; se o repositório for GitLab, use `.gitlab-ci.yml`) que roda install, lint, typecheck, test, test:integration e build.
- Auditoria de dependências (`pnpm audit --audit-level=high`) como etapa que falha o build.

### T10 — Estrutura de fixtures N8N
- `fixtures/n8n/README.md` explicando o formato de cada caso:
  - `<caso>/workflow.json`: export do N8N;
  - `<caso>/input.json`: dados de entrada do gatilho;
  - `<caso>/expected.json`: saída esperada por nó;
  - `<caso>/notes.md`.
- Se não houver fixtures reais, crie um caso de exemplo sintético (`exemplo-set-if`) e marque-o como sintético.

### T11 — Smoke test
- `pnpm smoke`: script que, com o compose em pé, verifica `GET /health` = 200, obtém um token do Keycloak para `admin@olly.local` (*password grant* habilitado **somente** no realm de dev) e chama `GET /api/v1/me`.

## Fora do escopo

Canvas, workflows, execução, nós concretos e fila.

## Critérios de aceite

| # | Critério | Verificação |
|---|---|---|
| 1 | `docker compose up -d` sobe todos os serviços *healthy* em uma máquina limpa seguindo o README | Manual + `pnpm smoke` |
| 2 | Login no frontend com `editor@olly.local` mostra o nome do usuário no cabeçalho | Teste E2E Playwright `auth.spec.ts` |
| 3 | `GET /api/v1/me` sem token retorna 401; com token retorna o usuário e as permissões do papel | Teste de integração |
| 4 | Migrations rodam `up` e `down` sem erro | Teste de integração `migrations.test.ts` |
| 5 | `UPDATE` em `audit_log` falha | Teste de integração |
| 6 | Pipeline de CI verde | CI |
| 7 | Todos os comandos da seção 8 do contexto global passam | Execução local |

## Entrega

Código no repositório, README raiz com instruções de setup e o relatório `docs/relatorios/sprint-00.md`.
