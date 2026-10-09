# Tarefas — Spec 017: Nó Basic LLM Chain

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Preparação

- [ ] T001 Exportar de `runtime/agent.ts` as funções de formato (`outputProblems`, `extractJson`) e a mensagem de correção, sem mudar o comportamento do Agent → plan §2

## Fase 2 — Fundação (bloqueia as histórias)

- [ ] T010 [P] `DynamicPorts` `fallbackModel` em `resolveNodePorts`, com testes (entrada `ai_fallbackModel` só com `needsFallback`) (FR-011) → plan §1
- [ ] T011 [P] `subNodes(kind, itemIndex, { port })` no motor, no `NodeContext` e no `fakeContext`, com testes (o Agent não muda) (FR-011) → plan §3

## Fase 3 — HU-1: Chamar o modelo com um prompt (P1)

- [ ] T020 Testes de unidade do nó com o modelo simulado: prompt do item e definido, mensagens na ordem, saída `text`, vários itens, prompt vazio, erro por item (FR-001, FR-002, FR-003, FR-004, FR-007)
- [ ] T021 `runtime/chain.ts` (`runChain`) e o nó `ai.chainLlm`, registrado em `builtin.ts` e exportado (FR-001 a FR-004, FR-007) → plan §1, §2
- [ ] T022 [P] Validação no motor: sem modelo e com dois modelos (FR-001) → plan §1

## Fase 4 — HU-2: Resposta em formato estruturado (P1)

- [ ] T030 Formato por JSON Schema: objeto em `output`, até 2 correções no mesmo modelo, falha clara, com testes (FR-005) → plan §2

## Fase 5 — HU-3: Uso e custo (P1)

- [ ] T040 Integração pela API e pela fila: uso e custo por chamada, limite mensal, Modelo de chat e Bridge simulada, sentinelas (FR-006, FR-010, SC-003, SC-004) → plan §2

## Fase 6 — HU-4: Modelo reserva (P2)

- [ ] T050 Reserva: troca na falha do principal, os dois falhando, limite e cancelamento sem troca, passo `error`, uso com o modelo que respondeu, com testes de unidade e de integração (FR-011, SC-006) → plan §2

## Fase 7 — HU-5: Passos no painel (P2)

- [ ] T060 Passos `model` (mensagens, resposta, tokens, `fallback`) e `final`, mascarados, com teste de integração (API e evento `agentStep`) (FR-012, SC-007) → plan §2
- [ ] T061 Editor: painel de passos para `ai.chainLlm` (mensagens e indicador de reserva) e ícone `link`, com E2E (FR-012) → plan §4

## Fase 8 — HU-6: Migração do N8N (P2)

- [ ] T070 Conversor do `chainLlm`, absorção do `outputParserStructured` (também no `agent`), reserva e avisos, com testes (FR-008, SC-005) → plan §5

## Fase 9 — Documentação

- [ ] T080 `docs/nos/ai.chainLlm.md`, catálogo, portas e um exemplo completo em `docs/nos/workflow-json.md`, `docs/importacao-n8n.md` (FR-009)

## Fase 10 — Verificação e relatório

- [ ] T090 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T092 Atualizar a documentação (`docs/nos/README.md`, `docs/arquitetura/contratos.md`)
- [ ] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
