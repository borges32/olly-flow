# Tarefas — Spec 003: Expressões, variáveis e execução de teste

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Preparação

- [x] T001 Migrations de `executions` e `node_executions` particionadas + `olly_ensure_partitions` (FR-014) → plan §6
- [x] T002 Atualizar `WorkflowDefinition` com `pinData` e `docs/arquitetura/contratos.md` (FR-016)

## Fase 2 — Fundação: sandbox de expressões

- [x] T010 Parser de templates e convenção `=` + testes (FR-001, FR-002) → plan §1
- [x] T011 `apps/task-runner`: fork supervisionado, mensagens zod, isolate por execução, `evaluateBatch` (FR-006) → plan §2
- [x] T012 Contexto de dados: `$json`, `$input`, `$('Nó')`, `$node`, `$vars`, `$env` filtrado, `$execution`, `$workflow`, Luxon (FR-003, FR-005) → plan §3
- [x] T013 Resolução de `.item` por *paired items* (FR-004) → plan §3
- [x] T014 Mensagens de erro com nó, parâmetro e trecho (FR-007)
- [x] T015 Testes de segurança do sandbox de expressões (FR-006, SC-003, SC-004)
- [x] T016 Suíte de compatibilidade (≥ 60 casos) + teste de fixtures aplicáveis (FR-019, SC-002)

## Fase 3 — HU-1 e HU-3: Expressões no engine e nós (P1)

- [x] T020 `getParam` com avaliação em lote, helper de `pairedItem` e pin data no engine (FR-016) → plan §4
- [x] T021 [P] `data.set` com expressões e `includeOtherFields` (FR-008) → plan §5
- [x] T022 [P] `data.setVariable` (FR-009) → plan §5
- [x] T023 [P] `logic.if` com operadores tipados (FR-010) → plan §5

## Fase 4 — HU-2 e HU-5: Execução de teste e histórico (P1)

- [x] T030 `ExecutionRecorder` com truncamento (FR-014, FR-015) → plan §6
- [x] T031 `POST /workflows/:id/test-run` com `destinationNodeId` (FR-011) → plan §7
- [x] T032 Gateway WebSocket com autorização por sala e eventos (FR-012, FR-013) → plan §7
- [x] T033 Painel do nó em três colunas, visões e status no canvas (FR-017) → plan §8
- [x] T034 Pin data na UI (FR-016)
- [x] T035 E2E `test-run.spec.ts` (SC-001)

## Fase 5 — HU-4: Ajuda na montagem de expressões (P2)

- [x] T040 `POST /expressions/preview` (FR-018) → plan §7
- [x] T041 Alternador Fixo/Expressão, Monaco com autocomplete e preview (FR-018) → plan §8
- [x] T042 Arrastar campo para o parâmetro + E2E `drag-field.spec.ts` (FR-018, SC-005)

## Fase 6 — Verificação e relatório

- [x] T089 Permissões RBAC: confirmar `execution:read` e `workflow:execute` no catálogo e no seed, exigi-las nas rotas e eventos e testar 403 por papel (FR-013) → plan, Permissões RBAC
- [x] T090 Rodar todos os comandos de verificação do AGENTS.md
- [x] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [x] T092 Documentar `docs/expressoes.md`, `docs/nos/logic.if.md`, `docs/nos/data.setVariable.md` e atualizar `docs/nos/data.set.md`
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
