# Tarefas — Spec 029: Acompanhamento ao vivo da execução

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Fundação

- [ ] T001 [P] Tipos `ExecutionSteps`, `ExecutionStep`, `RunningStep`, `LIVE_STEPS_LIMIT` e `metadataOnly` no `join`, em `packages/shared-types` → plan §Contratos
- [ ] T002 [P] `RunningSteps` (hash no Redis com TTL; `track` e `list`), chamado pelo `RedisEventPublisher` (no mesmo `multi()` do `PUBLISH`) e pelo `ExecutionEventsService.emit`; falha do Redis só gera aviso (FR-005) → plan §1

## Fase 2 — API (P1)

- [ ] T010 Rota `GET /executions/:id/steps` (`execution:read`): cabeçalho, passos sem dados com `limit` e `total`, passos em andamento, `resumeAt`, `nodeCount`/`executedNodeIds`, subexecuções (FR-002, FR-003, FR-005, FR-007, FR-010, FR-011, FR-012, FR-013, FR-016) → plan §2
- [ ] T011 WebSocket: `join` com `metadataOnly` (sala sem dados) e `leave` (FR-004, FR-013) → plan §3
- [ ] T012 [P] `status` com vários valores em `GET /executions` (FR-015) → plan §6
- [ ] T013 Integração `execution-steps.int.test.ts`: passo em andamento durante um nó lento e hash apagado no fim, campos, sem dados, `limit`/`total`, `resumeAt`, subexecuções, 404 sem permissão, `metadataOnly` e `leave`; filtro de vários status em `executions.int.test.ts` (FR-002 a FR-005, FR-007, FR-010 a FR-013, FR-015, FR-016, SC-004)

## Fase 3 — HU-1: Acompanhar pelo Log (P1)

- [ ] T020 `execution-log.ts` a partir de `ExecutionSteps` (passos em andamento, progresso, aviso do limite), ajustando os testes da spec 026 (FR-002, FR-003, FR-010, FR-016) → plan §5
- [ ] T021 `use-live-execution.ts`: join antes da consulta, eventos aplicados sem duplicar, limite de 500, `executionFinished` → Log completo, reconexão com ressincronização, consulta de reserva a cada 15 s, relógio de 1 s; testes de unidade das funções puras (FR-004, FR-005, FR-008, FR-009) → plan §4
- [ ] T022 Modal de Log em modo ao vivo: indicador "Ao vivo", tempo decorrido, progresso, passos em andamento destacados, rolagem automática, "Aguardando até", aviso do limite, cópia e downloads só no fim, execução excluída (FR-001 a FR-010, FR-016) → plan §5
- [ ] T023 Lista de execuções: menu nas ativas com **Acompanhar** (Excluir só nas terminadas) (FR-001) → plan §6

## Fase 4 — HU-3 e subexecuções (P2)

- [ ] T030 **Interromper** no modal, com confirmação, para quem tem `workflow:execute`, nas execuções `queued` e `running` (FR-014) → plan §5
- [ ] T031 Link da subexecução: acompanhamento se ativa, Log se terminou (FR-011) → plan §5

## Fase 5 — HU-2: Aviso no editor (P2)

- [ ] T040 Botão "N em andamento" no editor (consulta a cada 10 s com a aba visível; lista curta; abre o acompanhamento; some com N = 0; não aparece no canvas de uma execução) (FR-015) → plan §6

## Fase 6 — E2E

- [ ] T050 `apps/web/e2e/execution-live.spec.ts`: acompanhar pela lista um workflow com Esperar (nó em andamento e depois concluído, tempo correndo, fim com o Log completo), abrir no meio, erro destacado, reconexão (`setOffline`), Interromper (e o viewer sem a ação), aviso no editor, link da subexecução (FR-001, FR-004, FR-006, FR-008, FR-009, FR-011, FR-014, FR-015, SC-001 a SC-004)

## Fase 7 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T092 Atualizar a documentação: `docs/arquitetura/contratos.md` (rota, `join`/`leave`, filtro) e o guia das execuções
- [ ] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
