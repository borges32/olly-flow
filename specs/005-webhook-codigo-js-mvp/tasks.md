# Tarefas — Spec 005: Webhook, código JavaScript e fechamento do MVP

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:** `[P]` paralelizável · `(FR-xxx)` requisitos atendidos · `→ plan §X` seção com o detalhe técnico.

## Fase 1 — Fundação

- [ ] T001 `ExecutionDispatcher` + `InProcessDispatcher` (FR-003) → plan §2
- [ ] T002 Publicação/despublicação com sincronização de rotas e validações (FR-001, FR-002) → plan §1

## Fase 2 — HU-1 e HU-2: Webhook (P1)

- [ ] T010 Credenciais `webhookHeaderAuth`, `webhookBasicAuth` e `webhookHmac` (FR-004)
- [ ] T011 Gateway `/webhook/*`: resolução, limites, rate limit, CORS/IP, autenticação, item de saída (FR-004, FR-006) → plan §3
- [ ] T012 Modos de resposta e timeout 504 (FR-005) → plan §3
- [ ] T013 Nó `http.respondToWebhook` e validação na publicação (FR-008) → plan §4
- [ ] T014 Webhook de teste com escuta e evento no editor (FR-007) → plan §3
- [ ] T015 UI de publicação e de escuta de teste (FR-001, FR-007)
- [ ] T016 Testes de integração do webhook (SC-002, SC-003, SC-007)

## Fase 3 — HU-3: Código JavaScript (P1)

- [ ] T020 Mensagem `runCode` no task-runner com globais, console e limites (FR-009, FR-010) → plan §5
- [ ] T021 Nó `code.javascript` com `normalizeItems` e tratamento de queda do runner (FR-009, FR-011) → plan §5
- [ ] T022 [P] Editor Monaco com `.d.ts` e aba Console (FR-012) → plan §6
- [ ] T023 Testes de segurança do código JS (SC-006)

## Fase 4 — HU-4: Execuções (P1)

- [ ] T030 API de listagem e detalhe com `dataRedacted` (FR-013, FR-014) → plan §7
- [ ] T031 Tela `/executions` e canvas somente leitura com dados da execução (FR-013)
- [ ] T032 "Copiar para o editor" (FR-015)

## Fase 5 — HU-5: Permissões, auditoria e POC (P1)

- [ ] T040 Completar a auditoria das ações + teste de cobertura (FR-016) → plan §8
- [ ] T041 `rbac-matrix.test.ts` gerando `docs/rbac-matriz.md` (FR-017, SC-004) → plan §8
- [ ] T042 Recriar fixtures da POC em `fixtures/olly/` + `fixtures.int.test.ts` (FR-018, SC-001) → plan §9

## Fase 6 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md (SC-005)
- [ ] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T092 Documentar `docs/nos/trigger.webhook.md`, `docs/nos/http.respondToWebhook.md` e `docs/nos/code.javascript.md`
- [ ] T093 Escrever `report.md` com a seção extra **"Insumos para o Go/No-Go"** (planejado vs. entregue nas specs 001–005, dificuldades, riscos das specs 006–013) e atualizar o status em `spec.md` e `docs/roadmap.md`
