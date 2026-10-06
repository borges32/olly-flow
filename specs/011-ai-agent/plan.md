# Plano técnico — Spec 011: AI Agent

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Agente:** LangGraph.js (ReAct com *tool calling*). Usar as versões estáveis mais recentes e consultar a documentação vigente.
- **Canvas:** sub-nós (`ai_languageModel`, `ai_memory`, `ai_tool`) conectados à base do Agent.
- **Aprovação humana:** reutiliza o mecanismo de estado `waiting` da spec 008, mais o *checkpointer* Postgres do LangGraph.
- **Custo:** registrado por chamada ao modelo.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| III.7 | Somente tools conectadas e permitidas; `maxIterations`; aprovação humana; conteúdo de tool delimitado como não confiável |
| III.2 | `tool.postgresQuery` com SQL fixo; o modelo só fornece parâmetros |
| VI | Provedor atrás de credencial e allowlist (ADR-0008) |
| VIII.2 | `agent_steps` mascarado |
| IV | `FakeChatModel` determinístico |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/shared-types` | Tipos de porta `ai_*`; atualizar `contratos.md` |
| `packages/engine` | Sub-nós não executam no fluxo; o Agent os instancia; validação |
| `packages/nodes` | `ai.chatModel`, `ai.agent`, `tool.mcp`, `tool.httpRequest`, `tool.postgresQuery`, `tool.workflow`, `tool.code`, `memory.postgres`, `memory.buffer` |
| `packages/db` | `agent_steps`, `agent_memory`, `approval_requests`, `llm_usage`, `llm_pricing`, `langgraph_checkpoints` |
| `apps/api` | `/approvals`, `/admin/ai-usage`, preços, limites |
| `apps/web` | Portas inferiores, sub-nós, linha do tempo de passos, telas de aprovação e uso |

## Design

### §1 Sub-nós e validação
- `PortDef.kind`: `main` | `ai_languageModel` | `ai_memory` | `ai_tool`. Sub-nós têm apenas uma saída do seu tipo.
- **Engine:**
  - sub-nós ficam fora do agendador;
  - o Agent recebe `ctx.getSubNodes(kind)`, que instancia o objeto LangChain correspondente com os parâmetros resolvidos para o item atual.
- **Validação:**
  - `AGENT_MODEL_REQUIRED` (exatamente 1);
  - `AGENT_MEMORY_MAX` (≤ 1);
  - `SUBNODE_ON_MAIN` (sub-nó em porta `main`).

### §2 Modelos
- Credencial `openAiCompatible` (`baseURL`, **apiKey**, `organization?`), mais os tipos definidos pela ADR-0008.
- **`ai.chatModel`:** `model`, `temperature` e `topP` (opcionais, sem padrão: só vão ao provedor quando preenchidos), `maxTokens`, `timeout` e `maxRetries`. Instancia o `ChatModel` do LangChain.
- **Allowlist:** cadastro `ai_models` (instalação, mantido em Administração › IA, lido a cada uso: sem cache nem reinício) ∩ `projects.allowed_models` (opcional). Lista vazia = Agent indisponível (negado por padrão).
- **`FakeChatModel`** (somente testes, registrado com a flag `NODE_ENV=test`): roteiro de mensagens e `tool_calls`.

### §3 Agent
- **Grafo:** `createReactAgent` do LangGraph com:
  - `model.bindTools(tools)`;
  - `recursionLimit` derivado de `maxIterations`;
  - *checkpointer* Postgres (`thread_id = executionId:nodeId:runIndex:itemIndex`).
- **Parâmetros:** `promptSource` (`fromInput` → `$json.chatInput` | `define`), `text`, `systemMessage`, `maxIterations` (10, teto `OLLY_AGENT_MAX_ITERATIONS`), `returnIntermediateSteps` e `outputParser` (`none` | `jsonSchema` + `schema`).
- **`outputParser`:** valida com ajv. Se inválido, adiciona uma mensagem de correção e reinvoca, até 2 vezes. Depois, gera erro.
- **Saída:** `{ output, intermediateSteps?, usage: { inputTokens, outputTokens, model } }`.
- **Callbacks:** cada mensagem, *tool call* e resultado vira um registro em `agent_steps` (mascarado) e o evento `agentStep` via WebSocket. O uso é registrado em `llm_usage`.

### §4 Ferramentas
- **Base:** `name` (`^[a-zA-Z0-9_-]{1,64}$`, único no Agent), `description` obrigatória e `requireApproval` (bool).
- **`$fromAI(key, description?, type?)`:** função de expressão. O engine varre os parâmetros da tool, gera o JSON Schema de entrada da tool a partir das ocorrências e, na execução, substitui pelos argumentos do modelo.
- **Ferramentas:**

  | Ferramenta | Comportamento |
  |---|---|
  | `tool.mcp` | Servidor do catálogo + `tools: all-allowed \| lista`. Gera uma tool LangChain por tool MCP permitida, com o `inputSchema` do snapshot. Usa `packages/mcp-client`, política, snapshot e `mcp_calls`. `destructive` da política ⇒ aprovação |
  | `tool.httpRequest` | Parâmetros do `http.request` com `$fromAI`. Passa pelo `http-guard` |
  | `tool.postgresQuery` | `query` fixa (expressão proibida, como na spec 004) e `queryParameters` com `$fromAI`. Aviso na UI se a credencial não for `readOnly` |
  | `tool.workflow` | Sub-workflow publicado (spec 008). Schema vindo do `inputSchema` do `trigger.executeWorkflow` |
  | `tool.code` | JS no task-runner. `inputSchema` definido pelo editor |

- **Resultado de tool:** truncado em `OLLY_AGENT_TOOL_RESULT_MAX_CHARS` (20 000) e envolvido em `<tool_result source="..." untrusted="true">…</tool_result>`.

### §5 Memória
- **`memory.postgres`:** `agent_memory (session_id, role, content, created_at)`, `sessionKey` (expressão) e `contextWindowLength` (10). Retenção `retention.memoryDays` no job da spec 009.
- **`memory.buffer`:** em memória durante a execução.

### §6 Aprovação humana
- O *wrapper* de tool destrutiva lança `interrupt()` do LangGraph com `{ tool, args, reason }`.
- **O worker:**
  1. persiste o checkpoint (LangGraph) e o `execution_state` (spec 008);
  2. cria `approval_requests (id, execution_id, node_id, tool, args_masked, reason, status, expires_at, decided_by, comment)`;
  3. marca a execução `waiting`;
  4. agenda um job atrasado de expiração.
- **`POST /approvals/:id/approve|reject { comment }`** (`workflow:execute` no projeto): grava a decisão e enfileira a retomada. A retomada usa o `Command({ resume })` do LangGraph:
  - aprovado → executa a tool;
  - rejeitado → retorna `"Ação rejeitada pelo usuário: <comentário>"`.
- **Expiração** (`OLLY_APPROVAL_TIMEOUT_HOURS`, 24): rejeição automática.
- Auditoria de criação, decisão e expiração.
- **`blockToolCallsAfterUntrustedContent`** (padrão desligado): após o primeiro resultado de tool externa (MCP ou HTTP), toda tool com efeitos colaterais passa a exigir aprovação, mesmo sem a marcação `destructive`. Têm efeitos colaterais: `tool.httpRequest` com método diferente de GET, `tool.workflow`, `tool.code` e tools MCP sem a anotação `readOnlyHint`.

### §7 Custo
- **`llm_pricing (model, input_per_1k, output_per_1k, currency)`:** editável por admin.
- **`llm_usage`:** por chamada, com `cost_estimate` calculado.
- **Visualização:** a execução mostra os totais. `/admin/ai-usage` mostra por projeto, workflow e período.
- **Limite:** `projects.monthly_token_limit`. Antes de cada chamada, soma o mês corrente (cache Redis de 60 s). Ao exceder, gera `TokenLimitExceededError`.

### §8 Frontend
- **Agent no canvas:** portas inferiores rotuladas (Modelo, Memória, Ferramentas). Sub-nós compactos e arestas tracejadas.
- **Painel de execução do Agent:** linha do tempo dos passos (mensagem, tool, argumentos, resultado, tokens) em tempo real.
- **Telas:** `/approvals` (pendentes, com detalhe e decisão), `/admin/ai-usage` e preços.

## Modelo de dados

- Novas tabelas `agent_steps`, `agent_memory`, `approval_requests`, `llm_usage`, `llm_pricing` e as tabelas do *checkpointer* LangGraph.
- Novas colunas `projects.allowed_models` e `projects.monthly_token_limit`.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_AGENT_MAX_ITERATIONS` | 25 | Teto global |
| `OLLY_AGENT_TOOL_RESULT_MAX_CHARS` | 20000 | Truncamento |
| `OLLY_APPROVAL_TIMEOUT_HOURS` | 24 | Prazo de aprovação |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| LangGraph + `interrupt` | AgentExecutor clássico | Pausa/retomada nativa com checkpoint |
| SQL fixo na tool Postgres | Text-to-SQL | Elimina SQL gerado pelo modelo |
| `$fromAI` | Schema manual | Compatível com o N8N; menos configuração |

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001 | Unidade | `agent-validation.test.ts` |
| FR-002 | Unidade | `model-allowlist.test.ts` (SC-006) |
| FR-003, FR-005, FR-006, FR-007 | Integração | `agent.int.test.ts` com `FakeChatModel` (SC-001) |
| FR-004 | Unidade | `output-parser.test.ts` (SC-007) |
| FR-008 | Unidade | `tool-postgres.test.ts` |
| FR-009 | Integração | `memory.int.test.ts` (SC-008) |
| FR-010, FR-011 | Integração | `approval.int.test.ts`, incluindo reinício do worker (SC-003, SC-004) |
| FR-012, FR-013 | Unidade | `untrusted-content.test.ts` |
| FR-003 (limite) | Integração | `agent-loop-limit.int.test.ts` (SC-005) |
| FR-014, FR-015 | Integração | `llm-usage.int.test.ts` (SC-009) |

## Riscos

| Risco | Mitigação |
|---|---|
| APIs do LangChain mudam com frequência | Fixar versões; encapsular em `packages/nodes/src/ai/runtime` |
| Prompt injection residual | Defesa em camadas; aprovação humana; documentação do modelo de ameaça |

Ao concluir, produzir `docs/seguranca-agentes.md`.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 06/10/2026 | §3/§6: laço ReAct próprio sobre o `ChatModel` do LangChain (`packages/nodes/src/ai/runtime/agent.ts`) em vez de `createReactAgent`/`interrupt` do LangGraph; sem tabelas do *checkpointer*. Na aprovação, o Agent pausa com `NodeWaitSignal` (spec 008) e o estado do laço (mensagens serializadas, passos, uso) vai em `execution_state`; a retomada executa de novo o nó com as decisões (`ctx.resume`), sem chamar o modelo de novo para as chamadas já feitas | Um único mecanismo de estado (o da 008) para Wait e aprovação; evita a dependência do LangGraph e do seu esquema de banco, com o mesmo comportamento |
| 06/10/2026 | §2: provedores pelas credenciais `openAiCompatible`, `anthropic` e `googleGemini`; o Gemini usa o endpoint compatível com OpenAI (`GEMINI_OPENAI_BASE_URL`), sem `@langchain/google-genai`. Modelo simulado pela credencial `fakeLlm`, registrada só com `NODE_ENV=test`; o roteiro avança pelo número de respostas do assistente na conversa (sem estado, como um modelo real) | Menos dependências; o modelo simulado precisa continuar o roteiro depois da retomada |
| 06/10/2026 | §4: parâmetros comuns das ferramentas `toolName`, `toolDescription` e `requireApproval`; as expressões dos sub-nós enxergam os itens do nó pai (como no N8N). Efeitos colaterais: `tool.postgresQuery` fora de `SELECT/WITH/SHOW/EXPLAIN`, além dos do §6. As chamadas de `tool.mcp` são registradas em `mcp_calls` com o id do sub-nó | Compatível com o N8N; rastreabilidade das chamadas MCP |
| 06/10/2026 | §5: `agent_memory (project_id, session_key, message JSONB)` com a mensagem serializada do LangChain; a memória é isolada por projeto. A memória temporária vale só no processo e se perde numa retomada | A mesma chave de sessão em projetos diferentes não pode vazar conversa |
| 06/10/2026 | §6: `approval_requests` com `project_id`, `workflow_id`, `run_index`, `item_index` e `approval_key` (`<item>:<toolCallId>`, único por execução/nó/execução do nó); argumentos mascarados em `arguments`. A expiração roda na varredura de 30 s do worker (spec 008), não num job atrasado por pedido. Cancelar a execução cancela os pedidos pendentes. Escopo RBAC `{ approval }` (projeto do pedido); `GET /approvals` lista os pedidos dos projetos em que o usuário tem `workflow:execute` | Uma varredura cobre também pedidos cujo job se perderia; a decisão é autorizada no projeto do pedido |
| 06/10/2026 | §7: preços por 1 milhão de tokens (`input_per_1m`, `output_per_1m`), semeados com os preços públicos (migration `0012`). Cache do uso mensal e dos preços em memória do processo (60 s), não no Redis. Rotas: `GET /executions/:id/agent-steps` e `/ai-usage` (`execution:read`), `GET /projects/:id/ai-usage` (`project:manage`), `GET /ai-usage`, `GET/PUT/DELETE /ai-pricing` e `PUT /projects/:id/ai-settings` (`project:manage` global), `GET /projects/:id/ai-settings` (`workflow:read`), `GET /projects/:id/ai-models` (`credential:use`). Tela em `/admin/ai` | Unidade usada pelos provedores; o cache local basta para um limite aproximado |
| 06/10/2026 | Retenção (spec 009): o conteúdo de `agent_steps` é apagado com os dados da execução (`dataDays`); as linhas de `agent_steps` e `approval_requests` saem com os metadados (`metadataDays`), como `mcp_calls` | Minimização (constituição VIII): o texto do modelo e os resultados das ferramentas são dados da execução |
| 06/10/2026 | §8: o menu Aprovações aparece também para quem executa (aprova ações do agente) e a contagem inclui as ações pendentes. Retenção da memória (`retention.memoryDays`, padrão `OLLY_RETENTION_MEMORY_DAYS` 30) na governança do projeto | Aprovadores são os que têm `workflow:execute` (decisão humana) |
| 06/10/2026 | Estratégia de testes: os casos ficam em `packages/engine/src/agent.test.ts`, `packages/nodes/src/ai/runtime/agent.test.ts`, `packages/nodes/src/ai/chat-model/chat-model.test.ts`, `apps/web/src/editor/subnodes.test.ts` e nos testes de integração `apps/api/src/ai/{agent,approval,memory,llm-usage}.int.test.ts` (o limite de iterações SC-005 está em `agent.int.test.ts`) | Agrupados por camada |
| 06/10/2026 | §2: `topP` acrescentado; `temperature` e `topP` sem valor padrão, enviados só quando preenchidos (o padrão 0,7 fazia o `gpt-5-mini` recusar a chamada) | Nem todo modelo aceita esses parâmetros (spec, Histórico) |
| 06/10/2026 | §2: a allowlist da instalação vira o cadastro `ai_models (model, note, created_by, created_at)` (migration `0013_ai_models`), com `GET /ai-models` e `PUT|DELETE /ai-models/:model` (`project:manage` global, auditado: `ai.model_allow`, `ai.model_remove`) e a seção "Modelos permitidos" em `/admin/ai`; `OLLY_ALLOWED_MODELS` removida (sem semente: começa vazia). Remover um modelo da instalação não altera as listas dos projetos, mas ele deixa de valer nelas (interseção) | Decisão humana: mudar a lista não pode exigir reciclar os pods |
