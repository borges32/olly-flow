# Tarefas — Spec 012: Observabilidade (OpenTelemetry) e importador N8N

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Preparação

- [ ] T001 Migration `executions.trace_id`
- [ ] T002 [P] `packages/telemetry` (SDK, exportadores OTLP, recurso, desligado sem endereço) e coletor OTLP de teste para os testes de integração (FR-004) → plan §1
- [ ] T003 [P] Serviço opcional `otel-collector` no Compose (perfil `otel`, exportador `debug`) → plan §1

## Fase 2 — HU-1: Observabilidade com OpenTelemetry (P1)

- [ ] T010 Traces na API, no worker e no task-runner, com propagação e span por nó; `trace_id` gravado na execução (FR-001) → plan §2
- [ ] T011 [P] Métricas OTel exportadas por OTLP (FR-002) → plan §3
- [ ] T012 [P] Logs correlacionados (trace e span) exportados por OTLP, com mascaramento (FR-003) → plan §4
- [ ] T013 Resiliência: coletor desligado ou inacessível sem afetar execuções; medição do custo (FR-004, NFR-001, SC-006)
- [ ] T014 Testes de exportação e de vazamento com valores sentinela (SC-001, SC-002, SC-003)

## Fase 3 — HU-2: Importador (P1)

- [ ] T020 Conversão de nós e conexões com o mapeamento de portas (FR-005) → plan §5
- [ ] T021 [P] Conversores por tipo/versão + testes unitários (FR-005) → plan §5
- [ ] T022 Varredura de expressões, lista de credenciais, placeholders e bloqueio de publicação (FR-006, FR-007, FR-008) → plan §5
- [ ] T023 API com `dryRun` e tela `/workflows/import` com banner de pendências (FR-009) → plan §6
- [ ] T024 Importar todas as fixtures + `pnpm migration:report` (FR-010, SC-004, SC-005) → plan §7

## Fase 4 — Pentest

- [ ] T030 `docs/seguranca/escopo-pentest.md` + massa de dados de teste (FR-011) → plan §8

## Fase 5 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T092 Documentar `docs/observabilidade.md` (variáveis OTel, sinais, atributos, como apontar para o coletor)
- [ ] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
