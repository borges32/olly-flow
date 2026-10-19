# Tarefas — Spec 026: Ações da execução: excluir e ver o log

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Fundação

- [x] T001 Migration `0018_execution_parent_node` (up/down), schema do `packages/db` e testes de migration → plan §1
- [x] T002 [P] `execution:delete` no catálogo de permissões e testes do RBAC (FR-005) → plan §2
- [x] T003 [P] `nodeId` na chamada do `SubWorkflowGateway` e no contexto do motor; `parent_node_id` gravado (FR-004) → plan §1

## Fase 2 — API

- [x] T010 `purgeExecutions` compartilhada; manutenção passa a usá-la (NFR-002) → plan §2
- [x] T011 `subExecutions` no detalhe da execução (FR-004) → plan §2
- [x] T012 `DELETE /executions/:id` com permissão, 409 para execução ativa e auditoria; testes de integração (FR-005, SC-002) → plan §2

## Fase 3 — Web

- [x] T020 `execution-log.ts` (linhas, filtros, texto, JSON) com testes de unidade (FR-002 a FR-004) → plan §3
- [x] T021 Menu de ações, confirmação da exclusão e modal de log (FR-001 a FR-005) → plan §3
- [x] T022 E2E: menu, log (filtros, download, subexecução, abrir execução), exclusão e permissão (FR-001 a FR-005, SC-001, SC-002)

## Fase 4 — Verificação e relatório

- [x] T090 Rodar todos os comandos de verificação do AGENTS.md
- [x] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [x] T092 Atualizar a documentação (contratos, modelo de dados, permissões)
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
