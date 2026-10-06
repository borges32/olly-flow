# Relatório — Spec 011: AI Agent

**Status:** Implementada com pendências (SC-002 manual sem provedor de homologação; ADR-0008 pendente)
**Data:** 06/10/2026

## Resumo

- **Agente de IA** (`ai.agent`) com laço ReAct próprio sobre o LangChain:
  - prompt da entrada ou definido, mensagem de sistema, limite de iterações (10, teto da instalação);
  - passos intermediários opcionais e resposta estruturada por JSON Schema, com até 2 correções;
  - saída com resposta, passos e uso.
- **Sub-nós no canvas e no motor:**
  - Modelo de chat (OpenAI ou compatível, Anthropic, Gemini), memória persistente e temporária, e cinco ferramentas (MCP, HTTP, PostgreSQL com SQL fixo, sub-workflow, código);
  - portas na base do Agent, arestas tracejadas e validação de tipo e quantidade.
- **Segurança:**
  - lista permitida de modelos (instalação e projeto);
  - resultados de ferramenta truncados e delimitados como não confiáveis;
  - `$fromAI` só em parâmetros, nunca no SQL;
  - aprovação humana de ações destrutivas (pausa persistida que sobrevive à troca de worker; decisão em **Aprovações**; expiração; auditoria) e bloqueio opcional após conteúdo externo.
- **Passos do agente** gravados mascarados e transmitidos ao vivo (painel do nó).
- **Custo:** tokens e custo estimado por chamada; tabela de preços semeada e editável; uso por execução, workflow e projeto; limite mensal de tokens por projeto (**Administração › IA**).
- **Pré-requisito antecipado da spec 008** (decisão humana): estado e retomada (`waiting`), `flow.wait` e sub-workflow. Relatório parcial em [`specs/008-python-agendamento-subworkflow/report.md`](../008-python-agendamento-subworkflow/report.md).

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `infra/migrations/0012_ai_agent.{up,down}.sql`: `agent_steps`, `agent_memory`, `approval_requests`, `llm_usage`, `llm_pricing` (20 preços públicos semeados), `projects.allowed_models` e `monthly_token_limit`. Sem tabelas de *checkpointer*: o estado vai em `execution_state` (spec 008) |
| T002 | ✅ | `PortDef.maxConnections`, `SUBNODE_PORT_KINDS`, `isSubNodeType` (`packages/shared-types`); `contratos.md` |
| T010 | ✅ | Sub-nós fora do agendador; `ctx.subNodes(kind, item)` / `NodeDefinition.supplyData`; validações `SUBNODE_ON_MAIN`, `AGENT_MODEL_REQUIRED`, `AGENT_MEMORY_MAX`, `TOOL_NAME_*`, `TOOL_DESCRIPTION_REQUIRED` |
| T011 | ✅ | `FakeScriptedChatModel` (credencial `fakeLlm`, só com `NODE_ENV=test`); sem estado: o roteiro avança pelas respostas na conversa (necessário para a retomada) |
| T012 | ✅ | `ai.chatModel`; credenciais `openAiCompatible`, `anthropic`, `googleGemini`; `AiGateway.checkModel` (instalação ∩ projeto) |
| T013 | ✅ | `$fromAI` no sandbox de expressões (`@olly/expressions`, task runner) e schema gerado das ocorrências (`from-ai.ts`) |
| T020 | ✅ | `runAgent` (`packages/nodes/src/ai/runtime/agent.ts`): laço ReAct próprio, não `createReactAgent` (ver Desvios) |
| T021 | ✅ | `tool.mcp` via `McpGateway.agentTools` (política, snapshot, `mcp_calls`) |
| T022 | ✅ | `tool.httpRequest` (anti-SSRF e credencial do `http.request`) |
| T023 | ✅ | `tool.postgresQuery`: `query` com `x-no-expression`; só `queryParameters` com `$fromAI` |
| T024 | ✅ | `tool.workflow` (schema do gatilho do alvo) e `tool.code` (sandbox) |
| T025 | ✅ | `untrusted.ts`: truncamento e `<tool_result untrusted="true">` com o delimitador neutralizado |
| T026 | ✅ | `apps/api/src/ai/agent.int.test.ts` (SC-001, SC-005, SC-006, SC-007, FR-008) |
| T030 | ✅ | Pausa com `NodeWaitSignal.approvals`; `ApprovalsService` (criação, decisão, entrega e retomada, expiração na varredura de 30 s, cancelamento com a execução) |
| T031 | ✅ | `GET /approvals`, `POST /approvals/:id/approve|reject`; seção "Ações do agente" em `/approvals`; contagem no menu |
| T032 | ✅ | `blockToolCallsAfterUntrustedContent` (efeitos colaterais por ferramenta, `tools.md`) |
| T033 | ✅ | `apps/api/src/ai/approval.int.test.ts` (aprovação, rejeição, troca de worker, expiração, cancelamento, 403, auditoria) |
| T040 | ✅ | `memory.postgres` (por projeto e sessão, janela) e `memory.buffer`; retenção `memoryDays` no job da 009 e na tela de governança |
| T041 | ✅ | `outputParser: jsonSchema` (ajv), até 2 correções |
| T042 | ✅ | `llm_usage`, preços por 1M tokens, rotas de uso, `/admin/ai`, limite mensal (`TokenLimitExceededError`) |
| T050 | ✅ | Portas inferiores e sub-nós em pílula, arestas tracejadas, validação ao conectar (`subnodes.ts`), painel "Passos do agente" ao vivo com tokens e custo; lista `aiModels` no Modelo de chat |
| T090 | ✅ | Ver "Comandos de verificação" |
| T091 | ⚠️ | Pendente: sem chave de provedor de homologação neste ambiente (ADR-0008 não decidida) |
| T092 | ✅ | `docs/nos/ai.agent.md`, `ai.chatModel.md`, `tools.md`, `memory.md`, `docs/seguranca-agentes.md`; também `contratos.md`, `modelo-dados.md`, `credenciais.md`, `lgpd.md`, `docs/nos/README.md`, `README.md`, `.env.example` |
| T093 | ✅ | Este relatório; status em `spec.md` e `docs/roadmap.md` |

## Requisitos

Caminhos: `engine` = `packages/engine/src/agent.test.ts`; `runtime` = `packages/nodes/src/ai/runtime/agent.test.ts`; `int/<x>` = `apps/api/src/ai/<x>.int.test.ts`; `e2e` = `apps/web/e2e/agent.spec.ts`.

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `engine` › "FR-001: exige exatamente 1 modelo, no máximo 1 memória; sub-nó não entra no fluxo principal"; `apps/web/src/editor/subnodes.test.ts` (4 casos FR-001); `e2e` › "FR-001/FR-006" |
| FR-002 | Sim | `engine` › "FR-002/SC-006"; `packages/nodes/src/ai/chat-model/chat-model.test.ts` › "FR-016" (passa pela lista); `int/agent` › "SC-006" (instalação e projeto); `config.test.ts` › "spec 011 — ... FR-002" |
| FR-003 | Sim | `runtime` › "FR-003/FR-006", "FR-003/SC-005"; `engine` › "FR-003/FR-007"; `int/agent` › "SC-001", "SC-005" |
| FR-004 | Sim | `runtime` › "SC-007: resposta inválida é corrigida", "SC-007: falha depois de 2 correções"; `int/agent` › "SC-007" |
| FR-005 | Sim | `int/agent` › "SC-001" (`output`, `intermediateSteps`, `usage`); `engine` › "FR-003/FR-007" |
| FR-006 | Sim | `int/agent` › "SC-001" (passos mascarados na API e no WebSocket, sem conteúdo para o executor); `runtime` › "FR-003/FR-006"; `apps/web/src/editor/ndv/agent-steps-logic.test.ts` › "FR-006"; `e2e` › "FR-001/FR-006" |
| FR-007 | Sim | `engine` › "FR-007: ferramenta com nome inválido, repetido ou sem descrição é recusada"; `runtime` › "FR-007: o schema da ferramenta vem das ocorrências de $fromAI"; `int/agent` › "SC-001" (MCP e Postgres) |
| FR-008 | Sim | `int/agent` › "FR-008: a ferramenta Postgres não aceita SQL vindo do modelo" |
| FR-009 | Sim | `int/memory` › "SC-008", "FR-009: a janela...", "FR-009: a memória temporária...", "FR-009: a retenção..." |
| FR-010 | Sim | `runtime` › "FR-010"; `engine` › "FR-010"; `int/approval` › "SC-003: a ação destrutiva pausa..." |
| FR-011 | Sim | `runtime` › "FR-011"; `int/approval` › "SC-003: rejeitada...", "NFR-002: pedido vencido...", "FR-011: cancelar..." (403 para o leitor e auditoria no primeiro caso); `e2e` › "FR-010/FR-011" |
| FR-012 | Sim | `runtime` › "FR-012: resultado truncado e delimitador neutralizado" |
| FR-013 | Sim | `runtime` › "FR-013: depois de conteúdo externo, ferramenta com efeito colateral pede aprovação" |
| FR-014 | Sim | `int/llm-usage` › "FR-014: a tabela de preços...", "SC-009" |
| FR-015 | Sim | `int/llm-usage` › "FR-015: atingido o limite mensal..." |
| FR-016 | Sim | `chat-model.test.ts` › "FR-016: o modelo simulado só é aceito em testes"; todos os testes do agente usam o modelo simulado |
| NFR-001 | Sim | `engine` › "NFR-001: limite padrão de 10 iterações; o teto da instalação prevalece"; `config.test.ts` |
| NFR-002 | Sim | `config.test.ts` › "spec 011 — NFR-001/NFR-002/FR-002"; `int/approval` › "NFR-002" |

Também: `rbac-matrix.int.test.ts` (7 ações novas, `docs/rbac-matriz.md` regenerado) e `retention.int.test.ts` (conteúdo dos passos segue a retenção dos dados).

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `int/agent` › "SC-001": webhook (`lastNode`) → Agent com MCP `consulta_cliente` e Postgres; resposta com os dois resultados; 6 passos com o CPF mascarado; 3 chamadas registradas |
| SC-002 | ⚠️ Pendente | Manual com o provedor real: sem chave de homologação (ADR-0008). Ver "Como demonstrar" |
| SC-003 | ✅ | `int/approval` (aprovação e rejeição de `apagar_registro`); `e2e` › "FR-010/FR-011" (decisão pela tela) |
| SC-004 | ✅ | `int/approval` › "SC-004": o worker sai durante a espera, outro retoma após a aprovação |
| SC-005 | ✅ | `int/agent` › "SC-005" (`O agente atingiu o limite de 3 iterações sem uma resposta final`) |
| SC-006 | ✅ | `int/agent` › "SC-006" |
| SC-007 | ✅ | `int/agent` › "SC-007" |
| SC-008 | ✅ | `int/memory` › "SC-008" |
| SC-009 | ✅ | `int/llm-usage` › "SC-009" (custo 0,007 USD para 1 000/500 tokens a 2/10 USD por 1M) e "FR-015" |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ (626 testes) |
| `pnpm test:integration` | ✅ (300 testes: api 248, db 26, nodes 23, engine 3) |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ (37 cenários, incluindo os 3 de `agent.spec.ts`) |
| `pnpm app:up && pnpm smoke` | ✅ (imagens reconstruídas; migrations `0012` e `0013` aplicadas pelo `db-init`) |
| `pnpm audit --prod` | ✅ Nenhuma vulnerabilidade conhecida |

## Decisões tomadas

- **Laço ReAct próprio** em vez do LangGraph: a pausa para aprovação usa o mecanismo único de estado da spec 008 (`NodeWaitSignal` + `execution_state`), e a retomada reconstrói o agente das mensagens serializadas, sem chamar o modelo de novo. Evita o *checkpointer* do LangGraph e as suas tabelas.
- **Gemini pelo endpoint compatível com OpenAI:** uma dependência a menos (`@langchain/google-genai` não entrou).
- **Aprovadores = `workflow:execute`** e **sem limite mensal padrão** (decisão humana); **preços públicos semeados** (decisão humana), por 1 milhão de tokens.
- **Memória isolada por projeto** (`agent_memory.project_id`).
- **Modelo simulado sem estado:** o passo do roteiro sai do número de respostas do assistente na conversa. Assim a retomada continua o roteiro, e um roteiro cobre várias rodadas com memória.
- **E2E com `NODE_ENV=test`** na API e no worker do Playwright, para a credencial `fakeLlm` (só a documentação Swagger depende de `development`).
- **Correções encontradas na verificação:**
  - ciclo de importação `dispatcher → runner → sub-workflows → fila` (só aparecia no build ESM e num teste unitário): o `SubWorkflowService` agora resolve a fila por token (`SUBWORKFLOW_QUEUE`) via `ModuleRef`;
  - `AI_RUNTIME_PROVIDERS` saiu de `ai.module.ts` (`ai-runtime.ts`) pelo mesmo motivo;
  - corrida na espera: a execução aparecia como `waiting` antes de o estado e os pedidos de aprovação serem gravados (a tela mostraria "aguardando" sem nada para decidir). O runner agora grava os dois em `onExecutionFinish`, antes do status (teste de reprodução em `approval.int.test.ts` › "FR-010: a execução só aparece em espera depois...");
  - o nó `flow.executeWorkflow` passou a se chamar **"Executar sub-workflow"** (como o "Execute Sub-workflow" do N8N): o nome antigo coincidia com o botão "Executar workflow" do editor.
- **Modelos permitidos como cadastro (ajuste por decisão humana, 06/10/2026):** a lista da instalação saiu da variável `OLLY_ALLOWED_MODELS` (mudar exigia reciclar os pods) e virou o cadastro `ai_models` em Administração › IA, lido a cada uso: incluir ou remover vale na hora em todos os pods. Migration `0013_ai_models`; rotas `GET|PUT|DELETE /ai-models`; auditoria `ai.model_allow|remove`; testes em `apps/api/src/ai/ai-models.int.test.ts` e `e2e/agent.spec.ts` › "FR-002". Spec e plano atualizados antes do código.
- **Temperatura e top p opcionais (ajuste após teste manual, 06/10/2026):** o padrão 0,7 fazia o `gpt-5-mini` recusar a chamada. Agora `temperature` e o novo `topP` não têm padrão e só vão ao provedor quando preenchidos (spec e plano atualizados; testes em `chat-model.test.ts` › "FR-002: temperatura e top p opcionais").
- **Retenção:** o conteúdo dos passos do agente é apagado com os dados da execução (`dataDays`); as linhas saem com os metadados (teste antes da correção, em `retention.int.test.ts`).

## Desvios da spec/plano

Todos registrados no "Histórico de alterações" do [plan.md](plan.md) (06/10/2026) e, quanto à dependência da 008 e aos pontos resolvidos, no [spec.md](spec.md):

- LangGraph/`interrupt`/*checkpointer* → laço próprio + estado da spec 008;
- provedores e Gemini; `fakeLlm` só em teste;
- parâmetros comuns das ferramentas e efeitos colaterais da ferramenta PostgreSQL;
- esquema de `agent_memory` e `approval_requests`; expiração na varredura;
- preços por 1M tokens; cache local de 60 s em vez do Redis; nomes das rotas (`/ai-usage`, `/ai-pricing`, `/projects/:id/ai-settings`, `/admin/ai`);
- menu Aprovações para quem executa;
- retenção do conteúdo dos passos;
- arquivos de teste agrupados por camada.

Nenhum requisito da spec mudou.

## Dependências adicionadas

| Pacote | Versão | Motivo | Licença |
|---|---|---|---|
| `@langchain/core` | 1.2.16 | Mensagens, interface de modelo de chat e *tool calling* (plan §3) | MIT |
| `@langchain/openai` | 1.6.2 | Modelos OpenAI e compatíveis (inclui o Gemini pelo endpoint compatível) | MIT |
| `@langchain/anthropic` | 1.5.12 | Modelos Anthropic | MIT |

Todas em `packages/nodes`. O `ajv` já existia.

## Pendências, bloqueios e riscos

- **ADR-0008 (provedores e modelos aprovados) e chaves de homologação** (pré-requisito humano do roadmap): não decididas. A implementação segue o padrão da ADR proposta (provedor compatível com OpenAI + modelo simulado nos testes), atrás de credencial e da lista de modelos permitidos (cadastro em Administração › IA, que começa vazio). **SC-002 / T091** dependem disso.
- **Preços semeados** são os públicos na data da migration: conferir com os contratos (Administração › IA).
- **Retenção da memória** (padrão 30 dias) e das conversas: confirmar com o DPO, junto com as demais pendências de `docs/lgpd.md`.
- **Riscos:**
  - injeção de instruções residual: defesa em camadas descrita em `docs/seguranca-agentes.md`;
  - o limite mensal é aproximado: cache de 60 s por processo, então vários workers podem ultrapassar um pouco antes de bloquear;
  - a memória temporária se perde numa pausa para aprovação.
- **Mudança herdada de uma decisão anterior:** o `eslint-disable` justificado do SSE na spec 010 continua (sem relação com esta spec).

## Como demonstrar

1. Suba o ambiente (`pnpm app:up`), entre como `admin@olly.local` / `olly123` e, em **Administração › IA › Modelos permitidos**, libere o modelo (ex.: `gpt-5-mini`).
2. Em **Credenciais**, crie uma credencial **OpenAI ou compatível** (ou Anthropic, Gemini) com a chave de homologação.
3. Num workflow:
   - gatilho Webhook → **Agente de IA**;
   - na base do Agent, conecte **Modelo de chat** (escolha o modelo na lista), **Memória persistente** (`sessionKey` `{{ $json.body.sessao }}`) e as ferramentas **MCP** (servidor de teste `http://mcp-test:3333/mcp` aprovado em Administração › MCP, com `consulta_cliente` liberada e `apagar_registro` marcada como destrutiva) e **PostgreSQL** (SQL fixo com `$1 = {{ $fromAI('cidade') }}`).
4. Execute: o painel do Agent mostra os passos ao vivo, com tokens e custo.
5. Peça para apagar um registro: a execução fica "aguardando"; em **Aprovações**, como `executor@olly.local`, aprove ou rejeite e veja a execução retomar.
6. Em **Administração › IA**: uso por projeto e workflow, tabela de preços, modelos e limite mensal do projeto.

Sem chave de provedor, os cenários são reproduzidos pelos testes de integração e pelo E2E (`apps/web/e2e/agent.spec.ts`) com o modelo simulado.

## Próximos passos sugeridos

- Streaming da resposta do agente para o editor e para o webhook.
- Gatilho de chat (`trigger.chat`) com interface de conversa, como o "Chat Trigger" do N8N.
- Limite mensal compartilhado no Redis, se a precisão importar com muitos workers.
- Mais memórias (Redis) e ferramentas (busca vetorial/RAG), em specs próprias.
- Avaliação de qualidade dos agentes (conjuntos de teste com respostas esperadas).
