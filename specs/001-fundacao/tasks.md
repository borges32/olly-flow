# Tarefas — Spec 001: Fundação

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Preparação

- [x] T001 Criar o monorepo: pnpm workspaces, Turborepo, tsconfig base, ESLint, Prettier, `.editorconfig`, `.nvmrc` e scripts raiz (FR-001) → plan §1
- [x] T002 [P] Criar os workspaces vazios conforme `stack.md`, com READMEs indicando a spec de origem (FR-001) → plan §1
- [x] T003 [P] Criar `docker-compose.yml` com postgres, redis, keycloak e minio com healthchecks, e `.env.example` (FR-002) → plan §2
- [x] T004 [P] Criar o realm `infra/keycloak/olly-realm.json` com clients, grupos, usuários de teste e mapper de grupos (FR-003, NFR-003) → plan §2

## Fase 2 — Fundação

- [x] T010 `packages/db`: cliente Kysely, migrator e scripts `db:migrate`/`db:rollback` (FR-009) → plan §3
- [x] T011 Migrations de `users`, `roles`, `projects`, `project_members` e `audit_log` com trigger de imutabilidade (FR-009, FR-011) → plan §3
- [x] T012 Seed de papéis e permissões (FR-010) → plan §3
- [x] T013 [P] `packages/shared-types`: tipos e schemas zod dos contratos (FR-013) → plan §7
- [x] T014 [P] `packages/nodes`: contrato `NodeDefinition` e `NodeRegistry` com validação ajv (FR-014) → plan §7

## Fase 3 — HU-1 e HU-2: API, login e frontend (P1)

- [x] T020 `apps/api`: config zod, health, logger pino, exception filter, prefixo de rotas e Swagger dev (FR-012) → plan §4
- [x] T021 `AuthGuard` com JWKS, `@Public()`, `UserSyncService` e `PermissionResolver` por grupo (FR-004, FR-005, FR-008) → plan §5
- [x] T022 `GET /api/v1/me` (FR-006) → plan §5
- [x] T023 Testes de integração de autenticação: 401 sem token, token inválido, criação no primeiro login, `/me` (FR-004, FR-005, FR-006)
- [x] T024 `apps/web`: Vite, Tailwind, shadcn/ui, layout, rotas, tema e `apiClient` → plan §6
- [x] T025 Login OIDC no frontend: callback, *silent renew* e logout (FR-007) → plan §5
- [x] T026 E2E Playwright `auth.spec.ts`: login com `editor@olly.local` mostra o nome (FR-007, SC-002)

## Fase 4 — HU-3 e HU-4: Qualidade e base de auditoria

- [x] T030 [P] Testes de migrations up/down, seed e imutabilidade de `audit_log` (FR-009, FR-010, FR-011)
- [x] T031 [P] CI `.github/workflows/ci.yml` com auditoria de dependências bloqueante (FR-015) → plan §8
- [x] T032 [P] `fixtures/n8n/README.md` + exemplo sintético `exemplo-set-if` (FR-016) → plan §9
- [x] T033 `pnpm smoke` (FR-017) → plan §9

## Fase 5 — Verificação e relatório

- [x] T090 Rodar todos os comandos de verificação do AGENTS.md (SC-001, SC-003, SC-004, SC-005)
- [x] T091 Conferir que cada FR tem teste que o cita
- [x] T092 README raiz com setup passo a passo
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
