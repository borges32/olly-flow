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
- **`ai.chatModel`:** `model`, `temperature`, `maxTokens`, `timeout` e `maxRetries`. Instancia o `ChatModel` do LangChain.
- **Allowlist:** `OLLY_ALLOWED_MODELS` (instalação) ∩ `projects.allowed_models` (opcional).
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
| `OLLY_ALLOWED_MODELS` | — | Allowlist de modelos (lista) |
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
