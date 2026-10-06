# Tarefas — Spec 011: AI Agent

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Preparação

- [x] T001 Migrations: `agent_steps`, `agent_memory`, `approval_requests`, `llm_usage`, `llm_pricing`, checkpointer, colunas de projeto
- [x] T002 Tipos de porta `ai_*` em `shared-types` e `contratos.md` (FR-001) → plan §1

## Fase 2 — Fundação

- [x] T010 Sub-nós no engine (`getSubNodes`) e validações (FR-001) → plan §1
- [x] T011 `FakeChatModel` roteirizável (FR-016) → plan §2
- [x] T012 `ai.chatModel` com credencial `openAiCompatible` e allowlist (FR-002, SC-006) → plan §2
- [x] T013 `$fromAI` e geração do schema de entrada das tools (FR-007) → plan §4

## Fase 3 — HU-1: Agente com ferramentas (P1)

- [x] T020 `ai.agent` com LangGraph, limite de iterações, passos e uso (FR-003, FR-005, FR-006) → plan §3
- [x] T021 [P] `tool.mcp` (FR-007) → plan §4
- [x] T022 [P] `tool.httpRequest` (FR-007) → plan §4
- [x] T023 [P] `tool.postgresQuery` com SQL fixo (FR-007, FR-008) → plan §4
- [x] T024 [P] `tool.workflow` e `tool.code` (FR-007) → plan §4
- [x] T025 Truncamento e delimitação de conteúdo não confiável (FR-012) → plan §4
- [x] T026 Testes de integração do agente (SC-001, SC-005)

## Fase 4 — HU-2: Aprovação humana (P1)

- [x] T030 `interrupt` + persistência + `approval_requests` + expiração (FR-010, FR-011) → plan §6
- [x] T031 API e tela `/approvals` (FR-011)
- [x] T032 `blockToolCallsAfterUntrustedContent` (FR-013) → plan §6
- [x] T033 Testes de aprovação, rejeição e reinício (SC-003, SC-004)

## Fase 5 — HU-3, HU-4 e HU-5 (P2)

- [x] T040 [P] `memory.postgres` e `memory.buffer` + retenção (FR-009, SC-008) → plan §5
- [x] T041 [P] `outputParser` com JSON Schema (FR-004, SC-007) → plan §3
- [x] T042 Preços, `llm_usage`, telas de uso e limite mensal (FR-014, FR-015, SC-009) → plan §7

## Fase 6 — Editor

- [x] T050 Portas inferiores, sub-nós, linha do tempo de passos (FR-001, FR-006) → plan §8

## Fase 7 — Verificação e relatório

- [x] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Teste manual com o provedor real de homologação, se disponível (SC-002) — pendente: sem chave de provedor de homologação neste ambiente (ver report.md)
- [x] T092 Documentar `docs/nos/ai.agent.md`, `ai.chatModel.md`, `tools.md`, `memory.md` e `docs/seguranca-agentes.md`
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
