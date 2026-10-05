# Tarefas — Spec 007: Controle de fluxo

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Preparação

- [x] T001 Migration `workflows.error_workflow_id`; estrutura da suíte `packages/engine/reference/` → plan §8

## Fase 2 — Fundação: laços no engine

- [x] T010 Validação de ciclos por SCC + dominância (FR-008) → plan §2
- [x] T011 Reabertura do corpo, `runIndex` por nó e histórico de saídas (FR-009) → plan §2
- [x] T012 Escopo de iteração para `$('Nó')` e variáveis `$loop` (FR-007, FR-009) → plan §2

## Fase 3 — HU-2: While (P1)

- [x] T020 Nó `logic.while` com limite e acumulação (FR-005, FR-006) → plan §3
- [x] T021 Casos de referência 8, 9 e 11 (SC-002, SC-003)

## Fase 4 — HU-1: Merge (P1)

- [x] T030 Portas dinâmicas no engine e no canvas (FR-001)
- [x] T031 Nó `logic.merge`: modos, `waitFor`, `clashHandling` (FR-002, FR-003, FR-004) → plan §1
- [x] T032 Casos de referência 1–7 (SC-004)
- [x] T033 [P] Painel do Merge (FR-002)

## Fase 5 — HU-5: Erros como fluxo (P1)

- [x] T040 Porta `error` (`onError = errorOutput`) e opção na UI (FR-013) → plan §6
- [x] T041 `trigger.error` e despacho do error workflow com proteção de recursão (FR-014, FR-015) → plan §6
- [x] T042 Caso de referência 14 e teste de integração do error workflow (SC-006)

## Fase 6 — HU-3 e HU-4: Lotes e Switch (P2)

- [x] T050 [P] Nó `logic.loopOverItems` + caso 10 (FR-011) → plan §4
- [x] T051 [P] Nó `logic.switch` + casos 12–13 (FR-012) → plan §5

## Fase 7 — Editor

- [x] T060 Arestas de retorno, mensagem de ciclo inválido, seletor de iteração e rótulos de saída (FR-010, FR-016) → plan §7

## Fase 8 — Verificação e relatório

- [x] T090 `reference.test.ts` com `maxParallel` 1 e 8 (FR-017, SC-001)
- [x] T091 Rodar todos os comandos de verificação do AGENTS.md
- [x] T092 Documentar `docs/nos/logic.merge.md`, `logic.while.md`, `logic.loopOverItems.md`, `logic.switch.md` e `trigger.error.md`; atualizar `docs/execucao.md`
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
