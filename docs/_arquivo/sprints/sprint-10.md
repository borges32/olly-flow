# Sprint 10 — AI Agent

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Leia também os relatórios em `docs/relatorios/`, a ADR-008 em `docs/decisoes.md`, `docs/mcp-governanca.md` e a seção 9 de `docs/analise_implementacao.md`. Consulte a documentação vigente do LangChain.js/LangGraph.js e use as versões estáveis mais recentes.

## Pré-requisitos

- Sprint 9 concluída e todos os comandos da seção 8 passando.
- **Humano:** ADR-008 decidida, com a lista de provedores e modelos aprovados e as chaves de homologação disponíveis.
  - **se ainda não estiver decidida**, implemente a abstração com **um** provedor compatível com a API OpenAI (configurável por `baseURL`, o que cobre servidores locais como vLLM/Ollama) e um **modelo fake determinístico** para os testes. Registre a pendência.

## Contexto

Este é o objetivo central do projeto: agentes de IA que raciocinam e usam as ferramentas da plataforma (MCP, HTTP, Postgres, sub-workflows) dentro de workflows governados. Agentes recebem conteúdo não confiável (prompt injection), então os controles são obrigatórios:
- limite de passos;
- allowlist de tools;
- confirmação humana para ações destrutivas;
- log de cada passo.

## Objetivo

Nós de modelo de linguagem, nó `ai.agent` com tools e memória, aprovação humana de ações destrutivas e métricas de tokens e custo.

## Tarefas

### T1 — Sub-nós e conexões especiais no canvas
- Novo tipo de porta `ai_languageModel`, `ai_memory` e `ai_tool`, conectada **na base** do nó Agent, como no N8N.
- Sub-nós não executam no fluxo principal: o Agent os instancia.
- **Validação:**
  - o Agent exige exatamente 1 modelo, 0–1 memória e 0–N tools;
  - sub-nós não podem ser conectados a portas `main`.
- Atualize `WorkflowDefinition` se necessário (registre a alteração de contrato).

### T2 — Nó `ai.chatModel`
- Credenciais por provedor (tipos definidos conforme a ADR-008; no mínimo `openAiCompatible` com `baseURL`, `apiKey` e `organization?`).
- Parâmetros: `model` (lista vinda da credencial ou campo livre), `temperature`, `maxTokens`, `timeout` e `maxRetries`.
- **Allowlist de modelos** por instalação (`OLLY_ALLOWED_MODELS`) e por projeto. Modelos fora da lista são recusados.
- `FakeChatModel` para os testes, com respostas roteirizadas, incluindo *tool calls*.

### T3 — Nó `ai.agent`
- Implementação com **LangGraph.js** (agente ReAct com *tool calling*).
- **Parâmetros:**
  - `promptSource`: `fromInput` (campo `chatInput` do item, igual ao N8N) | `define` (expressão);
  - `systemMessage`;
  - `maxIterations` (padrão 10; teto `OLLY_AGENT_MAX_ITERATIONS`);
  - `returnIntermediateSteps: boolean`;
  - `outputParser`: `none` | `jsonSchema` (valida a resposta final contra um JSON Schema e pede correção ao modelo até 2 vezes).
- Executa **por item**.
- **Saída:** `{ output, intermediateSteps?, usage: { inputTokens, outputTokens, model } }`.
- Cada passo do agente (pensamento/mensagem, *tool call*, resultado) é registrado em `agent_steps` (`execution_id`, `node_id`, `run_index`, `item_index`, `step`, `type`, `content` mascarado, `tokens`, `duration`) e emitido via WebSocket para acompanhamento em tempo real.

### T4 — Tools para o agente (sub-nós `ai_tool`)
- **`tool.mcp`:** expõe ao agente as tools **permitidas** de um servidor MCP do catálogo (Sprint 9), com seleção `all allowed` ou lista específica. Reaproveite `packages/mcp-client`, políticas, snapshot e `mcp_calls`.
- **`tool.httpRequest`:** usa a configuração do `http.request` com `name`, `description` e parâmetros marcados como "definidos pelo modelo" (`$fromAI('nome', 'descrição', 'tipo')`, como no N8N). Passa pelo anti-SSRF.
- **`tool.postgresQuery`:** query **fixa** definida pelo editor com parâmetros `$fromAI(...)`. O modelo **nunca** escreve SQL. Credencial `readOnly` recomendada; mostre aviso se não for.
- **`tool.workflow`:** chama um sub-workflow publicado (Sprint 7) como tool, com `inputSchema` vindo do `trigger.executeWorkflow`.
- **`tool.code`:** função JS no task-runner com input definido pelo modelo.
- Toda tool tem `name` (validado: `^[a-zA-Z0-9_-]{1,64}$`, único no agente) e `description` obrigatórios.

### T5 — Memória (`ai_memory`)
- **`memory.postgres`:** histórico de conversa na tabela `agent_memory` (`session_id`, `role`, `content`, `created_at`), com `sessionKey` (expressão, ex.: `{{ $json.sessionId }}`) e `contextWindowLength` (últimas N mensagens).
- **`memory.buffer`:** em memória, só dentro da execução.
- O conteúdo da memória segue as regras de retenção da Sprint 8 (`retention.memoryDays`).

### T6 — Confirmação humana para tools destrutivas
- Uma tool é destrutiva quando é marcada como `destructive` na política MCP ou no próprio sub-nó (flag `requireApproval`).
- **Quando o agente chama uma tool destrutiva:**
  1. a execução vai para `waiting` (mecanismo do `flow.wait` da Sprint 7, que serializa o estado do grafo LangGraph com *checkpointer* Postgres);
  2. cria-se um registro `approval_requests` com a tool, os argumentos (mascarados para exibição) e o motivo informado pelo agente.
- Usuários com `workflow:execute` no projeto aprovam ou rejeitam em `/approvals` (contador no menu).
  - **aprovado:** a tool executa e o agente continua;
  - **rejeitado:** o agente recebe `"Ação rejeitada pelo usuário: <comentário>"` como resultado da tool e continua.
- Timeout de aprovação configurável (padrão 24 h), após o qual a chamada é rejeitada automaticamente.
- Tudo auditado.

### T7 — Proteções contra prompt injection
- `maxIterations` sempre aplicado; ao estourar, o resultado é um erro explícito.
- Resultados de tools são truncados (`OLLY_AGENT_TOOL_RESULT_MAX_CHARS`) e marcados no prompt como conteúdo não confiável (delimitadores claros).
- O agente só enxerga as tools conectadas e permitidas. Não existe tool genérica de "executar qualquer coisa".
- Opção `blockToolCallsAfterUntrustedContent` (padrão desligado): após ler conteúdo externo, tools destrutivas exigem aprovação mesmo sem a marcação.
- Documente o modelo de ameaça em `docs/seguranca-agentes.md`.

### T8 — Métricas de uso e custo
- Tabela `llm_usage` (`execution_id`, `project_id`, `model`, `input_tokens`, `output_tokens`, `cost_estimate`). Os preços vêm da configuração `llm_pricing` (por modelo, editável pelo admin), não do código.
- Exiba o uso e custo na execução, nos totais por workflow e em `/admin/ai-usage` (por projeto e período).
- **Limite opcional de tokens por projeto/mês:** ao atingir, novas chamadas falham com erro claro.

### T9 — Frontend
- Canvas: portas inferiores do Agent (Modelo, Memória, Tools), sub-nós menores e conexões tracejadas.
- Painel de execução do Agent: **linha do tempo dos passos** (mensagem, tool chamada, argumentos, resultado, tokens), em tempo real.
- Tela `/approvals`.

## Fora do escopo

RAG/vector store, chat trigger (interface de chat), *fine-tuning* e avaliação automática de respostas.

## Critérios de aceite

| # | Critério | Verificação |
|---|---|---|
| 1 | Webhook → Agent (FakeChatModel roteirizado) que consulta `tool.postgresQuery` e `tool.mcp` (`consulta_cliente`) e responde; cada passo visível no log | Integração |
| 2 | O mesmo cenário funciona com o provedor real de homologação (se disponível) | Teste manual registrado no relatório |
| 3 | Chamada a `apagar_registro` pausa a execução; a aprovação retoma e executa; a rejeição retorna a mensagem ao agente | Integração |
| 4 | Pausa para aprovação sobrevive a reinício do worker | Integração |
| 5 | Agente que entra em loop de tools para em `maxIterations` com erro explícito | Integração |
| 6 | Modelo fora da allowlist é recusado | Unitário |
| 7 | `outputParser: jsonSchema` corrige uma resposta inválida (Fake roteirizado) ou falha após 2 tentativas | Unitário |
| 8 | Memória Postgres mantém o contexto entre duas execuções com o mesmo `sessionId` | Integração |
| 9 | Tokens e custo registrados por execução; o limite mensal bloqueia novas chamadas | Integração |
| 10 | Toda a suíte das sprints anteriores verde | CI |

## Entrega

Código, `docs/nos/ai.agent.md`, `docs/nos/ai.chatModel.md`, `docs/nos/tools.md`, `docs/nos/memory.md`, `docs/seguranca-agentes.md` e o relatório `docs/relatorios/sprint-10.md`.

> 🏁 **Marco:** agentes em homologação.
