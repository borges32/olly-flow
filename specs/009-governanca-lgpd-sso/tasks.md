# Tarefas — Spec 009: Governança, SSO e LGPD

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Preparação

- [ ] T001 Migrations das novas tabelas e colunas (ver plan, Modelo de dados)
- [ ] T002 [P] Vault dev no Compose com Transit → plan §1

## Fase 2 — Fundação: Masker (bloqueia HU-5)

- [ ] T010 `mask()` com regras de campo e de valor + testes (aninhados, arrays, texto livre) (FR-014) → plan §6
- [ ] T011 Seed das regras padrão e CRUD de regras (FR-016)
- [ ] T012 Aplicar no recorder, no publisher WebSocket e no pino; teste de que os dados entre nós ficam intactos (FR-014, FR-015, SC-003)

## Fase 3 — HU-2: Cofre (P1)

- [ ] T020 `VaultTransitKeyProvider` e seleção por configuração (FR-001) → plan §1
- [ ] T021 Comandos `credentials:rotate` e `credentials:migrate` (FR-002, FR-003, SC-002)

## Fase 4 — HU-1: SSO (P1)

- [ ] T030 `GroupResolver`, `group_role_mappings` e sincronização com origem (FR-004, FR-005) → plan §2
- [ ] T031 Inativação e auditoria de login (FR-006, FR-007)
- [ ] T032 Tela `/admin/sso` + E2E (SC-001)

## Fase 5 — HU-5: Dados e retenção (P1)

- [ ] T040 `saveExecutionData` e payloads no object storage (FR-012, FR-013, SC-004) → plan §5
- [ ] T041 Job de retenção/partições com lock e auditoria (FR-017, SC-007) → plan §7

## Fase 6 — HU-3: Versões (P1)

- [ ] T050 API de versões, diff estruturado e restauração; mensagem obrigatória ao publicar (FR-008, FR-009) → plan §3
- [ ] T051 Painel de histórico e diff visual no canvas (FR-010, SC-005)

## Fase 7 — HU-4 e HU-6: Aprovação e auditoria (P2)

- [ ] T060 Pedidos de publicação com regra do autor ≠ aprovador (FR-011, SC-006) → plan §4
- [ ] T061 Consulta e exportação CSV em *streaming* da auditoria + tela (FR-018, SC-008) → plan §8
- [ ] T062 `executor_can_read_data` + matriz RBAC atualizada (FR-019) → plan §9

## Fase 8 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T092 Documentar `docs/governanca.md` e `docs/lgpd.md`; atualizar `docs/rbac-matriz.md` e `docs/arquitetura/modelo-dados.md`
- [ ] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
