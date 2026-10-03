# Tarefas — Spec 002: Editor visual, workflows e RBAC por projeto

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Preparação

- [ ] T001 Migrations de `workflows`, `workflow_versions` e `webhooks` (FR-001, FR-002)

## Fase 2 — Fundação (bloqueia as histórias)

- [ ] T010 `AbilityFactory`, `@RequirePermission`, `PermissionGuard` e `ResourceResolver` (FR-010, FR-011) → plan §1
- [ ] T011 Teste de cobertura RBAC das rotas (FR-012) → plan §1
- [ ] T012 `AuditService` reutilizável (FR-014)
- [ ] T013 [P] `validate.ts` com erros e avisos estruturais + testes (FR-004, FR-005) → plan §3
- [ ] T014 [P] `ExecutionState` e `runWorkflow` sequencial + testes (FR-016) → plan §4
- [ ] T015 [P] Nós `trigger.manual` e `data.set` + testes (FR-017, FR-018) → plan §5

## Fase 3 — HU-2: Controle de acesso por projeto (P1)

- [ ] T020 API de projetos, membros e usuários com auditoria (FR-013, FR-014) → plan §2
- [ ] T021 `/me` com permissões por projeto (FR-010)
- [ ] T022 Testes de integração: admin global, membro por papel, não membro → 404 (FR-010, FR-011)

## Fase 4 — HU-1: Montar e salvar um workflow (P1)

- [ ] T030 API de workflows com versionamento, 409 e validação (FR-001, FR-002, FR-003, FR-004) → plan §2
- [ ] T031 `GET /node-types` (FR-006)
- [ ] T032 Canvas: store Zustand, componente de nó, conexões, zoom, minimapa (FR-007) → plan §6
- [ ] T033 [P] Paleta de nós com busca e categorias (FR-007)
- [ ] T034 [P] Painel de parâmetros por JSON Schema com `x-display-options` e renomear nó (FR-009) → plan §7
- [ ] T035 Exibição dos erros de validação nos nós e diálogo de conflito 409 (FR-003, FR-005)
- [ ] T036 Telas `/workflows` e `/admin` com UI condicionada às permissões; modo somente leitura (FR-013, FR-015) → plan §8
- [ ] T037 E2E `editor.spec.ts` (SC-001) e `readonly.spec.ts` (SC-002)

## Fase 5 — HU-3: Produtividade (P2)

- [ ] T040 Desfazer/refazer, copiar/colar com nomes únicos, atalhos e indicador de não salvo (FR-008) → plan §6

## Fase 6 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T092 Documentar `docs/nos/README.md` (convenções de schema), `docs/nos/trigger.manual.md` e `docs/nos/data.set.md`
- [ ] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
