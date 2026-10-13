# Tarefas — Spec 020: Nó Schedule Trigger

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Preparação

- [ ] T001 `cron-parser` como dependência direta de `@olly/nodes` (versão do lockfile), com a justificativa no relatório → plan "Decisões técnicas"
- [ ] T002 Conferir no código do N8N 1.x (`ScheduleTrigger` 1.2, `recurrenceCheck`, formato da saída) o cron por regra, os módulos da recorrência, a semana do ano e os formatos dos campos; registrar valores de referência para o SC-003 e as diferenças no relatório → plan §2, §3

## Fase 2 — Fundação (bloqueia as histórias)

- [ ] T010 [P] `schedule/rules.ts`: `toSchedule`, `recurrenceUnit`, `recurrenceAllows`, `ruleIssues`, `nextRuns`, com testes (FR-001, FR-007, FR-008, SC-003) → plan §2
- [ ] T011 [P] `schedule/item.ts`: `scheduleItem`, com testes dos formatos do N8N (FR-005, SC-005) → plan §3
- [ ] T012 [P] `WorkflowSettings.timezone` (tipo, zod) e origem `schedule` em `shared-types`, com testes (FR-004) → plan §4
- [ ] T013 Migration `0016_workflow_schedules` (tabela e índice parcial), tipos do `@olly/db` e `docs/arquitetura/modelo-dados.md` (FR-002, FR-014) → plan §5

## Fase 3 — HU-4/HU-3: Nó e fuso (P1)

- [ ] T020 Nó `trigger.schedule` (parâmetros com `x-display-options`, execução no editor e em produção), registrado no catálogo, com testes (FR-001, FR-005, FR-006) → plan §1
- [ ] T021 Fuso do workflow no `ExecutionRunner` e na prévia de expressões (`$now`, `$today`), com teste de integração (FR-004) → plan §4

## Fase 4 — HU-2: Publicação e agendamentos ativos (P1)

- [ ] T030 `scheduleIssues` na publicação (`SCHEDULE_RULE_INVALID`, `SCHEDULE_TIMEZONE_INVALID`) e no painel de problemas (FR-007) → plan §5
- [ ] T031 Publicar, despublicar e excluir gravam ou removem `workflow_schedules`; auditoria com `details.schedules`; aviso `olly:schedules:changed` (FR-002, FR-012) → plan §5
- [ ] T032 `ScheduleSync` no worker (partida, aviso, periódica, lock), com testes de integração de troca de versão, despublicação e reinício (FR-002, FR-003, SC-002) → plan §6

## Fase 5 — HU-1: Disparo (P1)

- [ ] T040 `ScheduleProcessor`: horário agendado, vigência, atraso, recorrência, sobreposição com lock e lançamento com a origem `schedule`; métrica `olly.schedule.occurrences` (FR-003, FR-009, FR-014, FR-015) → plan §7
- [ ] T041 Integração: regra de minuto com 2 workers (SC-001), recorrência de intervalo maior que 1, execução em andamento pula, regras coincidentes geram uma execução, ocorrência atrasada é descartada, cota e workflow de erro (FR-003, FR-009, FR-014, FR-015, SC-001)

## Fase 6 — HU-3: Prévia e editor (P1)

- [ ] T050 Rota `POST /workflows/:id/schedule/preview` (`workflow:read`), com testes de integração e da matriz RBAC (FR-007) → plan §8
- [ ] T051 [P] `SchedulePanel` (próximas 5 execuções, fuso efetivo, problemas, aviso de publicação), fuso nas configurações do workflow, ícone e rótulo "Agendamento" no log de execuções (FR-004, FR-007) → plan §4, §8
- [ ] T052 E2E `apps/web/e2e/schedule.spec.ts`: configurar regras, ver as próximas execuções, regra inválida apontada, executar no editor (FR-006, FR-007)

## Fase 7 — HU-5/HU-6: Importação e exportação (P1/P2)

- [ ] T060 Conversor do `scheduleTrigger` (1 a 1.2), segundos múltiplos de 60, pendência dos demais e `settings.timezone`, com testes (FR-010, FR-011, SC-004) → plan §9
- [ ] T061 Exportação como `scheduleTrigger` 1.2 com o fuso; caso no teste de ida e volta (FR-010, SC-004) → plan §9
- [ ] T062 Fixture sintética `fixtures/n8n/exemplo-schedule-trigger` (quatro arquivos) e relatório consolidado regenerado (SC-004)

## Fase 8 — Documentação

- [ ] T070 `docs/nos/trigger.schedule.md`; `workflow-json.md` (catálogo e exemplo); `importacao-n8n.md` (scheduleTrigger deixa de ser marcador); `execucao.md` (agendamento, sobreposição, atraso); `contratos.md`; marcação da spec 008 (FR-013)

## Fase 9 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T092 Atualizar a documentação (`docs/nos/README.md`, `docs/arquitetura/`)
- [ ] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
