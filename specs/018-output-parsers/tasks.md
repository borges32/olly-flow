# Tarefas — Spec 018: Output Parsers como no N8N

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Fundação (bloqueia as histórias)

- [x] T001 Tipo de conexão `ai_outputParser` em `shared-types` (tipo, zod, listas, ordem no arquivo) e `DynamicPorts` `aiRootInputs`, com testes (FR-001) → plan §1
- [x] T002 `OutputParserSupply` e `OutputParserError` no runtime; inferência de schema por exemplo movida para `@olly/nodes` (FR-002, FR-003) → plan §2, §3
- [x] T003 Sub-nós de sub-nós no motor (limite de 5 níveis), com testes (FR-004) → plan §5

## Fase 2 — HU-2/HU-4: Structured e Item List (P1/P2)

- [x] T010 [P] `outputParser.structured` (exemplo e schema, `autoFix`), com testes (FR-003) → plan §3
- [x] T011 [P] `outputParser.itemList` (separador, marcadores, limite), com testes (FR-005) → plan §3

## Fase 3 — HU-1: Agent e Basic LLM Chain com parser (P1)

- [x] T020 `hasOutputParser` e a entrada `ai_outputParser` no Agent e no Basic LLM Chain; `runAgent` e `runChain` com o parser (instruções, `output`, correção pelo modelo do nó); remoção de `outputParser` e `schema`; testes atualizados (FR-001, FR-002, FR-007) → plan §4

## Fase 4 — HU-3: Auto-fixing (P2)

- [x] T030 `outputParser.autoFixing` (próprio modelo e parser, uma tentativa, prompt personalizável, ganchos do nó pai), com testes de unidade e do motor (FR-004, FR-007) → plan §3, §5

## Fase 5 — HU-5: Migração e importação (P1)

- [x] T040 `migrateLegacyOutputParser`, com testes (idempotente, nomes únicos) (FR-006) → plan §6
- [x] T041 Migração na API (leitura, salvamento, execução) e em `fromWorkflowFile` (FR-006, SC-004) → plan §6
- [x] T042 Importador do N8N, nós pais: `hasOutputParser` no AI Agent e no Basic LLM Chain, sem o aviso de parser; remoção da absorção (`structuredParserSchema`, `PARSER_TARGETS`); testes antigos atualizados (FR-008, FR-009) → plan §7
- [x] T043 Importador do N8N, parsers: Structured (1 a 1.3, inclusive o `jsonSchema` da v1), Auto-fixing (prompt e conexões em cadeia) e Item List; conexões `ai_outputParser` mantidas, convivendo com o reserva, com testes (FR-008, FR-009, SC-005) → plan §7
- [x] T044 Pendências no relatório (opção sem parser, parser sem destino, Auto-fixing incompleto, exemplo inválido); fixture sintética em `fixtures/n8n/` com os três parsers e o relatório consolidado regenerado (FR-010, SC-005) → plan §7

## Fase 6 — Integração e editor

- [x] T050 Integração pela API: Structured (com e sem `autoFix`), Auto-fixing, Item List, uso e passos das correções, workflow antigo migrado (FR-002 a FR-007, SC-001 a SC-004)
- [x] T051 [P] Editor: cor e rótulo de `ai_outputParser`, ícones dos parsers, E2E da entrada nova (FR-001) → plan §8

## Fase 7 — Documentação

- [x] T060 `docs/nos/output-parsers.md`; `ai.agent.md` e `ai.chainLlm.md` (opção nova, sem o schema no nó); `workflow-json.md` (tipo de conexão, catálogo, exemplos atualizados para o parser); `importacao-n8n.md` (FR-010, FR-011)

## Fase 8 — Verificação e relatório

- [x] T090 Rodar todos os comandos de verificação do AGENTS.md
- [x] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [x] T092 Atualizar a documentação (`docs/nos/README.md`, `docs/arquitetura/contratos.md`)
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
