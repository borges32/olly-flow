# Tarefas — Spec 010: Cliente MCP

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Preparação

- [ ] T001 Migrations `mcp_servers`, `mcp_tool_policies` e `mcp_calls`; permissão `mcp:manage` no seed
- [ ] T002 [P] Servidor MCP de teste (HTTP + stdio, `MUTATE_SCHEMA`) (FR-013) → plan §7

## Fase 2 — Fundação: cliente

- [ ] T010 `packages/mcp-client`: pool, `initialize`, operações com paginação, timeout, cancelamento e limite (FR-006) → plan §3
- [ ] T011 Transportes HTTP/SSE com `guardedFetch` (FR-004, SC-005) → plan §3
- [ ] T012 `StdioLauncher` em container efêmero (FR-005) → plan §3

## Fase 3 — HU-1: Governança (P1)

- [ ] T020 API de catálogo, teste, aprovação e políticas (FR-001, FR-002) → plan §1
- [ ] T021 Snapshot e bloqueio por divergência + aceitação (FR-003, SC-003) → plan §2
- [ ] T022 Tela `/admin/mcp` (catálogo, tools, liberação, destrutiva, diff)

## Fase 4 — HU-2: Nó Cliente MCP (P1)

- [ ] T030 Nó `ai.mcpClient` com validação, política, binários e `isError` (FR-008, FR-009, FR-010, FR-012) → plan §5
- [ ] T031 Painel dinâmico a partir do `inputSchema` (FR-009)
- [ ] T032 Registro em `mcp_calls`, aba na execução e auditoria de negação (FR-011, FR-012, SC-007) → plan §6
- [ ] T033 Testes de integração HTTP e stdio (SC-001, SC-002, SC-004)

## Fase 5 — HU-3: Autenticação (P2)

- [ ] T040 Credenciais `mcpBearer`, `mcpHeaders` e `mcpOAuth` com callback e *refresh* (FR-007, SC-006) → plan §4

## Fase 6 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T092 Documentar `docs/nos/ai.mcpClient.md` e `docs/mcp-governanca.md`; atualizar a matriz RBAC
- [ ] T093 Escrever `report.md` (incluindo a versão da especificação MCP) e atualizar o status em `spec.md` e `docs/roadmap.md`
