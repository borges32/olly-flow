# Tarefas — Spec 012: Observabilidade, importador N8N e homologação

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Preparação

- [ ] T001 Migration `executions.trace_id`
- [ ] T002 [P] `docker-compose.observability.yml` com *provisioning* → plan §2

## Fase 2 — HU-1: Observabilidade (P1)

- [ ] T010 OTel em API, worker, task-runner e python-runner, com propagação (FR-001) → plan §1
- [ ] T011 Link do trace na UI (FR-001, SC-001)
- [ ] T012 [P] Métricas Prometheus (FR-002) → plan §2
- [ ] T013 [P] Dashboards e regras de alerta versionados (FR-003, SC-002) → plan §2
- [ ] T014 Logs correlacionados + exportação SIEM configurável + mascaramento (FR-004) → plan §3
- [ ] T015 Teste de vazamento em traces, métricas e logs (SC-003)

## Fase 3 — HU-2: Importador (P1)

- [ ] T020 Conversão de nós e conexões com o mapeamento de portas (FR-005) → plan §4
- [ ] T021 [P] Conversores por tipo/versão + testes unitários (FR-005) → plan §4
- [ ] T022 Varredura de expressões, lista de credenciais, placeholders e bloqueio de publicação (FR-006, FR-007, FR-008) → plan §4
- [ ] T023 API com `dryRun` e tela `/workflows/import` com banner de pendências (FR-009) → plan §5
- [ ] T024 Importar todas as fixtures + `pnpm migration:report` (FR-010, SC-004, SC-005) → plan §6

## Fase 4 — HU-3: Implantação (P1)

- [ ] T030 Helm chart com segurança, probes, PDB, HPA e hook de migrations (FR-011, FR-012) → plan §7
- [ ] T031 Job de CI com kind: install + smoke + teste de egress (SC-006, SC-007)
- [ ] T032 `docs/deploy.md`

## Fase 5 — HU-4: Carga e pentest (P2)

- [ ] T040 Cenários k6 e execução com registro dos resultados (FR-013, SC-008) → plan §8
- [ ] T041 `docs/seguranca/escopo-pentest.md` + massa de dados de teste (FR-014) → plan §9

## Fase 6 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T092 Documentar `docs/observabilidade.md`
- [ ] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
