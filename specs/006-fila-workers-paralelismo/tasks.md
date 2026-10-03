# Tarefas — Spec 006: Fila, workers e paralelismo

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Preparação

- [ ] T001 Migrations: `execution_payloads`, `executions.heartbeat_at`, `projects.max_concurrent_executions`
- [ ] T002 [P] Dockerfiles multi-stage e Compose com `api` e `worker` separados (FR-014) → plan §8

## Fase 2 — Fundação: agendador concorrente

- [ ] T010 Estados de nó/porta, prontidão e propagação de "sem dados" + testes (FR-007) → plan §3
- [ ] T011 Laço concorrente com `maxParallel` e concatenação determinística + testes (FR-006, FR-008) → plan §3
- [ ] T012 Confirmar a suíte anterior verde com `maxParallel = 1` e `8`

## Fase 3 — HU-3: Execução escalável e resiliente (P1)

- [ ] T020 `QueueDispatcher` com payload fora da fila e `waitForResult` via pub/sub (FR-001, FR-002) → plan §1
- [ ] T021 `apps/worker`: processor, health/metrics, shutdown gracioso (FR-004) → plan §2
- [ ] T022 Relay de eventos Redis → WebSocket na API (FR-003)
- [ ] T023 Detecção de `worker_lost` (stalled + heartbeat) (FR-005) → plan §2
- [ ] T024 Testes de resiliência com kill do worker (SC-004)

## Fase 4 — HU-1 e HU-2: Paralelismo (P1)

- [ ] T030 Teste de ramos paralelos e determinismo (SC-001, SC-002)
- [ ] T031 `supportsParallelItems` e `ctx.mapItems` nos nós elegíveis + aba Configurações (FR-009) → plan §4
- [ ] T032 Teste de paralelismo por item (SC-003)

## Fase 5 — HU-4: Cancelar e limitar (P2)

- [ ] T040 Cancelamento com `AbortController` raiz e timeout global (FR-010, FR-011) → plan §5
- [ ] T041 Semáforo de cota por projeto e `queue-stats` (FR-012) → plan §6
- [ ] T042 Testes de cancelamento e de cota (SC-005, SC-006)

## Fase 6 — Visualização

- [ ] T050 Nós e arestas ativos simultâneos, aba "Linha do tempo", botão "Parar" (FR-013) → plan §7

## Fase 7 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md (SC-007)
- [ ] T091 Executar o k6 e registrar os resultados (NFR-002) → plan §8
- [ ] T092 Escrever `docs/execucao.md`
- [ ] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
