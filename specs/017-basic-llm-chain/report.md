# Relatório — Spec 017: Nó Basic LLM Chain

**Status:** Implementada com pendências (E2E de fps do canvas abaixo do mínimo no ambiente atual, sem relação com a spec; workflows reais da POC)
**Data:** 09/10/2026

## Resumo

Foi entregue o nó **Basic LLM Chain** (`ai.chainLlm`), que faz uma chamada ao modelo de chat por item:
- **Entrada:** prompt do item ou definido no nó, com mensagens de sistema e de exemplo antes dele.
- **Saída:** em `text` (como no N8N) ou, com JSON Schema, um objeto em `output`, com até 2 correções.
- **Modelo reserva:** entrada opcional, usada quando o modelo principal falha.
- **Governança e painel:** segue a governança de IA da spec 011, e as chamadas aparecem no painel do nó.

A importação do N8N converte o `chainLlm`. O Structured Output Parser vira o JSON Schema do nó, tanto no Basic LLM Chain quanto no Agent.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `correctionPrompt` exportado de `runtime/agent.ts` (`outputProblems` e `extractJson` já eram); o Agent usa a mesma função |
| T010 | ✅ | `DynamicPorts` `fallbackModel` e `FALLBACK_MODEL_PORT` em `packages/shared-types/src/ports.ts` |
| T011 | ✅ | `subNodes(kind, itemIndex, { port })` em `packages/engine/src/run.ts` e no `NodeContext` |
| T020–T022 | ✅ | `packages/nodes/src/ai/runtime/chain.ts`, `packages/nodes/src/ai/chain-llm/definition.ts` e testes |
| T030 | ✅ | JSON Schema com correções no modelo que respondeu |
| T040 | ✅ | `apps/api/src/ai/chain-llm.int.test.ts` |
| T050 | ✅ | Modelo reserva (unidade, motor e integração) |
| T060–T061 | ✅ | Passos `model`, `error` e `final`; painel "Chamadas ao modelo" com a etiqueta "modelo reserva"; ícone `link`; E2E |
| T070 | ✅ | `apps/api/src/workflow-io/n8n/converters.ts` (`convertChainLlm`, `structuredParserSchema`) e `convert.ts` (absorção do parser) |
| T080 | ✅ | `docs/nos/ai.chainLlm.md`, `docs/nos/workflow-json.md` (catálogo, portas, exemplo 12.7), `docs/importacao-n8n.md` |
| T090–T093 | ✅ | Ver abaixo |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `packages/nodes/src/ai/chain-llm/chain-llm.test.ts` › "FR-001/FR-002/FR-004…", "FR-001: sem modelo ligado…", "FR-001/FR-011: a entrada \"Modelo reserva\"…"; `packages/engine/src/chain-llm.test.ts` › "FR-001/FR-011: exige o modelo…" |
| FR-002 | Sim | `chain-llm.test.ts` › "FR-001/FR-002/FR-004…", "FR-002: prompt do campo `chatInput`…"; `engine/src/chain-llm.test.ts` › "FR-002: sem o reserva habilitado…" |
| FR-003 | Sim | `chain-llm.test.ts` › "FR-003: mensagens de sistema e de exemplo…"; `chain-llm.int.test.ts` › "SC-004/FR-010…" (mensagens no corpo enviado à Bridge) |
| FR-004 | Sim | `chain-llm.test.ts` › "FR-001/FR-002/FR-004…"; `chain-llm.int.test.ts` › "SC-001/SC-007/FR-006/FR-012…" |
| FR-005 | Sim | `chain-llm.test.ts` › "FR-005: resposta válida vira objeto…", "FR-005: resposta fora do formato é corrigida…", "FR-005/FR-011: as correções do formato usam o modelo que respondeu"; `chain-llm.int.test.ts` › "SC-002/FR-005…" |
| FR-006 | Sim | `chain-llm.test.ts` › "FR-006/FR-012…", "FR-006: limite mensal…"; `chain-llm.int.test.ts` › "SC-001/…/FR-006…", "SC-003/FR-006…" |
| FR-007 | Sim | `chain-llm.test.ts` › "FR-007: \"continuar\" e \"saída de erro\" valem por item" |
| FR-008 | Sim | `apps/api/src/workflow-io/n8n/n8n.test.ts` › "FR-008/SC-005: prompt, mensagens, parser estruturado e modelo reserva…", "FR-008: prompt do item, imagens e lotes geram avisos…", "Agent com modelo, memória e ferramentas; o Structured Output Parser vira o JSON Schema (spec 017, FR-008)" |
| FR-009 | Sim | `apps/api/src/workflow-io/docs.test.ts` › "SC-003: todo tipo de nó registrado está documentado" e "…exemplos completos importáveis" (exemplo 12.7 com o `ai.chainLlm` e o reserva) |
| FR-010 | Sim | `chain-llm.int.test.ts` › "SC-004/FR-010…" (senha e tokens da Bridge fora dos passos, dados e logs) |
| FR-011 | Sim | `chain-llm.test.ts` › bloco "HU-4: modelo reserva" (6 casos); `engine/src/chain-llm.test.ts` › "FR-011: `subNodes` por entrada…"; `chain-llm.int.test.ts` › "SC-006/FR-011…"; E2E `agent.spec.ts` › "FR-011/FR-012…" |
| FR-012 | Sim | `chain-llm.test.ts` › "FR-006/FR-012…"; `chain-llm.int.test.ts` › "SC-001/SC-007/FR-006/FR-012…" (API, evento `agentStep`, mascaramento); E2E `agent.spec.ts` › "FR-011/FR-012: entrada do modelo reserva; chamadas no painel…" |
| NFR-001 | Sim | Sem correção, uma chamada por item (`chain-llm.test.ts` confere o número de chamadas) |
| NFR-002 | Sim | Testes com o modelo simulado (`fakeLlm`/`FakeScriptedChatModel`) e a Bridge simulada |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `chain-llm.test.ts` (vários itens) e `chain-llm.int.test.ts` › "SC-001/…" |
| SC-002 | ✅ | `chain-llm.test.ts` e `chain-llm.int.test.ts` › "SC-002/FR-005…" |
| SC-003 | ✅ | `chain-llm.int.test.ts` › "SC-001/…" (uso em `llm_usage`) e "SC-003/FR-006…" (limite mensal) |
| SC-004 | ✅ | `chain-llm.int.test.ts`: Modelo de chat e "SC-004/FR-010" (Bridge Chat Model) |
| SC-005 | ✅ (sintético) | `n8n.test.ts` › "FR-008/SC-005…". Os workflows reais da POC ainda não estão em `fixtures/n8n/` |
| SC-006 | ✅ | `chain-llm.int.test.ts` › "SC-006/FR-011…" |
| SC-007 | ✅ | `chain-llm.int.test.ts` › "SC-001/SC-007…" (CPF mascarado nos passos e nos eventos) e E2E |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ (na 1ª rodada, um erro de lint num teste novo; corrigido) |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 794 testes (na 4ª rodada; ver abaixo) |
| `pnpm build` | ✅ |
| `pnpm test:integration` | ✅ 363 testes (api 309, db 28, nodes 23, engine 3) |
| `pnpm test:e2e` | ⚠️ 44 de 45 cenários passam, inclusive o novo do Basic LLM Chain. Falha o "NFR-001: canvas com 100 nós mantém ≥ 30 fps" (spec 002), detalhado abaixo |
| `pnpm app:up && pnpm smoke` | ✅ |

**Teste de fps do canvas (spec 002, NFR-001):**
- **Resultado:** passava na verificação da spec 016 (07/10/2026). Hoje mediu 29,75 fps no E2E completo e de 19,5 a 28,7 fps isolado, contra o mínimo de 30.
- **Por que não é desta spec:** com os três arquivos do editor alterados pela spec de volta à versão do último commit, o resultado foi o mesmo (19,5 e 19,7 fps). A queda vem do ambiente desta máquina (renderização do navegador), não do código.
- **Pendência:** confirmar numa máquina livre ou no CI antes de marcar a spec como `Verificada`.

**Falhas intermitentes nas rodadas (sem relação com esta spec):**
- **`expressions/sandbox.test.ts` › "NFR-002: 1000 itens × 3 expressões em menos de 1 s":** é a medição de tempo já conhecida nas specs 009, 010 e 015. Passou 3 de 3 vezes isolada.
- **E2E `webhook-code.spec.ts` › "FR-009/FR-012: editor de código com autocomplete…" (spec 005):** o autocompletar do Monaco ficou em "Loading..." (worker do editor carregando). Passou na rodada seguinte.
- **Teste de expressões nas rodadas 2 e 3:** com a máquina carregada (média de carga de 6,8 a 10,9 em 8 núcleos), mediu 2,8 s. Na 4ª rodada passou com 926 ms.

## Decisões tomadas

- **`runChain` próprio**, reaproveitando do Agent a validação e a extração do formato, a mensagem de correção, o `contentText` e os ganchos de uso e passos. O Agent não aceita mensagens de exemplo nem reserva, e o loop de ferramentas não tem uso aqui.
- **Modelo reserva:**
  - **Entrada:** fica numa segunda porta `ai_languageModel` (`ai_fallbackModel`), por portas dinâmicas. No JSON do arquivo é o índice 1, como no N8N, então a importação liga o reserva sem regra especial.
  - **Quando aciona:** é acionado quando a chamada ao principal lança. O limite mensal (reconhecido pelo nome do erro, `TokenLimitExceededError`) e o cancelamento não acionam o reserva.
- **Objeto estruturado em `output`** e texto em `text`, conforme o plano.
- **Sem lotes:** o nó declara `supportsParallelItems` e usa a execução paralela por item (spec 006).
- **Passos:** usam a tabela, a rota e o evento do Agent. O painel ganhou um título por tipo de nó ("Chamadas ao modelo") e a etiqueta "modelo reserva".
- **Structured Output Parser do N8N:** é absorvido também no Agent, que antes só gerava aviso, como previsto no plano §5. O teste antigo do importador ("o output parser é descartado com nota") foi atualizado para o novo comportamento.

## Desvios da spec/plano

Nenhum. Um teste da spec 015 (`n8n.test.ts`, importação do Agent com parser) mudou de expectativa por causa da absorção do parser, prevista no plano §5.

## Dependências adicionadas

Nenhuma.

## Pendências, bloqueios e riscos

- **Fixtures:** os workflows reais da POC com o Basic LLM Chain em `fixtures/n8n/`, para o SC-005 com dados reais.
- **Schema inferido:** o schema inferido de um exemplo do N8N (`jsonSchemaExample`) marca todos os campos como obrigatórios. A importação avisa para revisar.
- **E2E de fps do canvas (spec 002):** abaixo de 30 fps no ambiente atual, também sem as mudanças desta spec no editor. Confirmar numa máquina livre ou no CI.
- **Testes intermitentes:** os testes intermitentes acima já eram conhecidos e não têm relação com esta spec.

## Como demonstrar

1. `pnpm app:up` e entre no editor (`http://localhost:5173`).
2. Em Administração › IA, libere um modelo. Crie a credencial do provedor (ou use a Bridge).
3. Monte **Gatilho manual → Basic LLM Chain**:
   - ligue um **Modelo de chat** à entrada "Modelo";
   - em "Prompt", escolha `define` com `=Resuma: {{ $json.texto }}` e acrescente uma mensagem `system`;
   - execute: a saída tem `text`, e o painel do nó mostra "Chamadas ao modelo".
4. Ligue "Modelo reserva", conecte um segundo modelo e use no principal um modelo inexistente. A saída vem do reserva, com a etiqueta "modelo reserva" no painel.
5. Em **Importar** (formato N8N), cole um workflow com `chainLlm` e `outputParserStructured`: o parser vira o JSON Schema do nó.

## Próximos passos sugeridos

- Outras chains do N8N (Question and Answer, Summarization), se surgirem nos workflows da POC.
- Mensagens com imagem, se houver demanda de modelos multimodais.
