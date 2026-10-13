# Relatório — Spec 018: Output Parsers como no N8N

**Status:** Implementada com pendências (dois testes de tempo de specs anteriores falham neste ambiente; ver "Comandos de verificação")
**Data:** 09/10/2026

## Resumo

O Agent e o Basic LLM Chain ganharam **"Exigir formato específico"** (`hasOutputParser`), que acrescenta a entrada **Output Parser** (`ai_outputParser`). Três sub-nós equivalentes aos do N8N:
- **Structured:** exemplo JSON ou JSON Schema, com correção automática pelo modelo do nó;
- **Auto-fixing:** próprio modelo e parser interno, com prompt de correção;
- **Item List:** separador e número de itens.

**Formato antigo:** o JSON Schema dentro do nó foi substituído. Workflows salvos, versões publicadas e arquivos antigos são migrados automaticamente na leitura, no salvamento, na execução e na importação.

**Importação do N8N:** traz os parsers como sub-nós, com as conexões em cadeia e as pendências no relatório.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `PortKind` `ai_outputParser`; `DynamicPorts` `aiRootInputs` (substitui `fallbackModel`); `OUTPUT_PARSER_PORT` |
| T002 | ✅ | `packages/nodes/src/ai/runtime/output-parser.ts` (`OutputParserSupply`, `OutputParserError`, `jsonSchemaOfExample`) |
| T003 | ✅ | `packages/engine/src/run.ts`: sub-nós de sub-nós, escopo das expressões no nó raiz, `MAX_SUBNODE_DEPTH` (5) |
| T010–T011 | ✅ | `packages/nodes/src/ai/output-parsers/definitions.ts` (Structured, Item List) |
| T020 | ✅ | `runAgent`/`runChain` com `outputParser`; `hasOutputParser` e `outputParserOf` no Agent e no Basic LLM Chain; `correctionPrompt` com as instruções do parser |
| T030 | ✅ | Auto-fixing (mesmo arquivo), pelos ganchos do nó pai |
| T040 | ✅ | `packages/shared-types/src/legacy-output-parser.ts` (`migrateLegacyOutputParser`) |
| T041 | ✅ | `workflowDefinitionInputSchema` (entradas da API), `readDefinition` (`apps/api/src/workflows/definition.ts`, 12 leituras do banco), `fromWorkflowFile` |
| T042–T044 | ✅ | Importador: `hasOutputParser`, conversores dos três parsers, conexões `ai_outputParser`, pendências; absorção removida; fixture `fixtures/n8n/exemplo-output-parsers` e relatório consolidado regenerado |
| T050 | ✅ | `apps/api/src/ai/output-parsers.int.test.ts` |
| T051 | ✅ | `apps/web/src/editor/subnodes.ts` (rótulo), `node-icons.ts` (`braces`, `wrench`, `list`), E2E em `agent.spec.ts` |
| T060 | ✅ | `docs/nos/output-parsers.md`, `ai.agent.md`, `ai.chainLlm.md`, `workflow-json.md` (tipo de conexão, catálogo, exemplo 12.7 com parser), `importacao-n8n.md` |
| T090–T093 | ✅ | Ver abaixo; `docs/nos/README.md` e `docs/arquitetura/contratos.md` atualizados |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `packages/nodes/src/ai/chain-llm/chain-llm.test.ts` › "FR-001 (spec 018): com a opção ligada e sem parser…"; `packages/engine/src/output-parsers.test.ts` › "FR-001: com a opção ligada, o parser é obrigatório…"; E2E `agent.spec.ts` › "FR-001/FR-002: \"Exigir formato específico\"…" |
| FR-002 | Sim | `chain-llm.test.ts` › "FR-005/FR-002 (spec 018)…" (instruções no prompt, `output`); `runtime/agent.test.ts` › "SC-007…" (instruções no pedido); `engine/src/output-parsers.test.ts` › "FR-002/FR-004…" |
| FR-003 | Sim | `packages/nodes/src/ai/output-parsers/output-parsers.test.ts` › "FR-003: …" (3 casos); `apps/api/src/ai/output-parsers.int.test.ts` › "SC-001/FR-002/FR-003…" |
| FR-004 | Sim | `output-parsers.test.ts` › "FR-004/FR-007…", "FR-004: resposta válida não chama o modelo…", "FR-004: prompt de correção personalizado", "FR-004: sem modelo…"; `engine/src/output-parsers.test.ts` › "FR-002/FR-004…", "FR-004: sub-nós encadeados demais…"; `output-parsers.int.test.ts` › "SC-002/FR-004/FR-007…" |
| FR-005 | Sim | `output-parsers.test.ts` › "FR-005: …" (2 casos); `engine/src/output-parsers.test.ts` › "FR-005: Agent com Item List…"; `output-parsers.int.test.ts` › "SC-003/FR-005…" |
| FR-006 | Sim | `packages/shared-types/src/legacy-output-parser.test.ts` › "FR-006: …" (2 casos); `n8n.test.ts` › "FR-006/HU-6: arquivo do Olly Flow no formato antigo…"; `output-parsers.int.test.ts` › "SC-004/FR-006…" (versão gravada no formato antigo: leitura, entrada, execução e publicação). Os testes antigos das specs 011 e 017 que criam workflows com o schema no nó pela API continuam passando pela migração |
| FR-007 | Sim | `output-parsers.test.ts` › "FR-004/FR-007…"; `output-parsers.int.test.ts` › "SC-002/FR-004/FR-007…" (uso e passos com o modelo do Auto-fixing) |
| FR-008 | Sim | `n8n.test.ts` › "SC-005/FR-008/FR-009…", "FR-008: Structured da v1…", e os testes das specs 011/017 atualizados (Agent e Basic LLM Chain com parser como sub-nó) |
| FR-009 | Sim | `n8n.test.ts` › "SC-005/FR-008/FR-009…" (conexões em cadeia, reserva com parser) e "FR-008/SC-005: prompt, mensagens, parser estruturado e modelo reserva…" |
| FR-010 | Sim | `n8n.test.ts` › "FR-010: opção sem parser, parser sem destino e exemplo inválido…", "FR-008: …o Auto-fixing incompleto aparece no relatório (spec 018)"; relatório consolidado das fixtures |
| FR-011 | Sim | `apps/api/src/workflow-io/docs.test.ts` (tipos documentados; exemplo 12.7 com parser importável) |
| NFR-001 | Sim | `output-parsers.test.ts` › "FR-004: resposta válida não chama o modelo…" |
| NFR-002 | Sim | Modelo simulado em todos os testes |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `output-parsers.int.test.ts` › "SC-001…" (Agent) e `chain-llm.test.ts` (Basic LLM Chain) |
| SC-002 | ✅ | `output-parsers.int.test.ts` › "SC-002…" |
| SC-003 | ✅ | `output-parsers.int.test.ts` › "SC-003…" |
| SC-004 | ✅ | `output-parsers.int.test.ts` › "SC-004…" |
| SC-005 | ✅ | `n8n.test.ts` › "SC-005…" e a fixture `exemplo-output-parsers`: 9 nós, 0 não suportados. As 6 pendências são as credenciais fictícias e os modelos, descritas no `notes.md` |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ⚠️ Todos os pacotes verdes, exceto 1 teste: `expressions/sandbox.test.ts` › "NFR-002: 1000 itens × 3 expressões em menos de 1 s" (spec 003) |
| `pnpm build` | ✅ |
| `pnpm test:integration` | ✅ 368 testes (api 314, db 28, nodes 23, engine 3) |
| `pnpm test:e2e` | ⚠️ 45 de 46 cenários, inclusive o novo da spec 018. Falha o "NFR-001: canvas com 100 nós mantém ≥ 30 fps" (spec 002): mediu 29,1 fps |
| `pnpm app:up && pnpm smoke` | ✅ |

**Os dois testes que falham não envolvem esta spec:**
- **Teste de expressões:** o pacote de expressões não foi alterado. Isolado, passou 2 de 2 vezes. Dentro do `pnpm test`, com os pacotes em paralelo e a máquina carregada (média de carga de 11 a 13 em 8 núcleos), mediu de 1,1 s a 3,1 s, contra o limite de 1 s.
- **Fps do canvas:** é o mesmo caso já registrado na spec 017. Lá, o teste caiu também com os arquivos do editor na versão anterior às mudanças, o que aponta para o ambiente desta máquina.
- **Pendência:** confirmar os dois numa máquina livre ou no CI antes de marcar a spec como `Verificada`.

## Decisões tomadas

- **Migração sem reescrever o histórico:** `migrateLegacyOutputParser` é pura e idempotente. Na API, roda nas entradas (`workflowDefinitionInputSchema`, nos quatro schemas de entrada) e nas leituras do banco (`readDefinition`, nos 12 pontos que liam a definição). As versões publicadas, que são imutáveis, não são reescritas; o formato antigo no banco continua executando com o mesmo resultado.
- **Correção automática na migração:** o parser criado tem `autoFix: true`, para manter as 2 correções que o nó fazia antes.
- **Instruções no fim do pedido:** as instruções de formato vão ao fim do pedido, como no N8N. O pedido de correção traz as instruções do parser, no lugar do JSON Schema.
- **Auto-fixing:** usa os ganchos do nó pai (limite mensal, uso com o modelo do Auto-fixing, passo `model` com `fixer: true`). Assim, as correções aparecem no painel do nó.
- **Sub-nós de sub-nós:** as expressões continuam vendo os itens do nó raiz, e a cadeia tem limite de 5 níveis.
- **`aiRootInputs`:** substitui o `fallbackModel` da spec 017, para o Basic LLM Chain ter o reserva e o parser ao mesmo tempo.
- **Inferência do schema:** a inferência pelo exemplo JSON passou para `@olly/nodes` (`jsonSchemaOfExample`), e o importador deixou de inferir.

## Desvios da spec/plano

Nenhum. Testes das specs 011, 015 e 017 que esperavam o schema dentro do nó, ou a absorção do parser, foram atualizados para o comportamento da spec 018, conforme o FR-009.

## Dependências adicionadas

Nenhuma.

## Pendências, bloqueios e riscos

- **Testes de tempo:** os dois testes acima (specs 002 e 003) precisam ser confirmados numa máquina livre ou no CI.
- **Formato do arquivo exportado:** o arquivo exportado mudou (o parser é um nó, como no N8N). Arquivos antigos continuam importáveis.
- **Fixtures reais:** faltam os workflows reais da POC com output parsers, quando houver.

## Como demonstrar

1. `pnpm app:up` e entre no editor.
2. Num **Basic LLM Chain** (ou **Agent**), ligue **"Exigir formato específico"**: aparece a entrada **Output Parser**.
3. Ligue um **Structured Output Parser** com o exemplo `{"nota": 1}` e execute: a saída traz `output.nota`.
4. Troque por um **Auto-fixing** com um modelo próprio e o Structured dentro dele. Numa resposta inválida, o painel "Chamadas ao modelo" mostra a correção com o modelo do Auto-fixing.
5. Abra um workflow criado antes desta spec com o JSON Schema no nó: ele aparece com o Structured Output Parser ligado e executa igual.
6. Importe `fixtures/n8n/exemplo-output-parsers/workflow.json` no formato N8N: nenhum nó vira marcador.

## Próximos passos sugeridos

- Confirmar no CI os testes de tempo das specs 002 e 003, e avaliar torná-los menos sensíveis à carga da máquina.
