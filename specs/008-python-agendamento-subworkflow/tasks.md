# Tarefas — Spec 008: Python, agendamento e nós auxiliares

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Preparação

- [ ] T001 Migrations: `execution_state`; colunas `parent_execution_id`, `depth` e `retry_of`; status `waiting`
- [ ] T002 [P] Estrutura de `security/sandbox/` e job de CI dedicado (FR-017)

## Fase 2 — HU-1: Python (P1)

- [ ] T010 `apps/python-runner`: FastAPI, autenticação por token, `/run`, `/health` (FR-002) → plan §1
- [ ] T011 nsjail por requisição com limites e `bootstrap.py` com a API N8N (FR-001, FR-004) → plan §1
- [ ] T012 Dockerfile com allowlist e hardening do container (FR-003) → plan §1
- [ ] T013 Nó `code.python` com cancelamento e normalização (FR-004, FR-005, FR-006) → plan §2
- [ ] T014 [P] Editor Monaco Python com autocomplete `_*`
- [ ] T015 Bateria de escape JS + Python (≥ 30 casos) (FR-017, SC-002) → plan §9

## Fase 3 — HU-2: Agendamento (P1)

- [ ] T020 `trigger.schedule` com schedulers na publicação/despublicação (FR-007) → plan §3
- [ ] T021 Validação de cron e prévia das próximas execuções (FR-008)
- [ ] T022 Teste com 2 workers (SC-004)

## Fase 4 — HU-5: Reexecução (P1)

- [ ] T030 `POST /executions/:id/retry` com pré-carga das saídas (FR-014) → plan §7
- [ ] T031 `startNodeId` + `sourceExecutionId` na execução de teste e botões na UI (FR-015) → plan §7

## Fase 5 — HU-3 e HU-4: Sub-workflow, Wait e Stop (P2)

- [ ] T040 `trigger.executeWorkflow` e `flow.executeWorkflow` com permissões, profundidade e recursão (FR-009, FR-010, FR-011) → plan §4
- [ ] T041 Serialização e retomada de estado + `flow.wait` (FR-012) → plan §5
- [ ] T042 [P] `flow.stopAndError` (FR-013) → plan §6

## Fase 6 — HU-6: Paginação (P2)

- [ ] T050 Paginação no `http.request` com `$response`/`$pageCount` (FR-016) → plan §8

## Fase 7 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T092 Documentar `docs/nos/code.python.md`, `trigger.schedule.md`, `flow.executeWorkflow.md`, `flow.wait.md`, `flow.stopAndError.md` e `docs/seguranca-sandbox.md`
- [ ] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
