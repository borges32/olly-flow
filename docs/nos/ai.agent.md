# Agente de IA (`ai.agent`)

Agente que usa um modelo de linguagem com chamada de ferramentas (laço ReAct): o modelo lê o pedido, decide chamar ferramentas, recebe os resultados e responde. Equivale ao nó "AI Agent" (Tools Agent) do N8N, com os controles da [spec 011](../../specs/011-ai-agent/spec.md): só ferramentas conectadas, limite de iterações, aprovação humana de ações destrutivas, resultados de ferramenta tratados como não confiáveis e custo registrado. Modelo de ameaça: [docs/seguranca-agentes.md](../seguranca-agentes.md).

| Item | Valor |
|---|---|
| Categoria | IA |
| Entradas | `main`; na base do nó: **Modelo** (`ai_languageModel`, obrigatório, no máximo 1), **Memória** (`ai_memory`, no máximo 1) e **Ferramentas** (`ai_tool`, 0 ou mais) |
| Saídas | `main` (e `error` com `onError: errorOutput`) |
| Sub-nós | [Modelo de chat](ai.chatModel.md), [memórias](memory.md), [ferramentas](tools.md) |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `promptSource` | `fromInput` (padrão): o campo `chatInput` do item; `define`: o texto abaixo |
| `text` | Pedido ao agente (`define`). Aceita expressão, ex.: `{{ $json.body.pergunta }}` |
| `systemMessage` | Instruções do sistema (padrão: "Você é um assistente útil.") |
| `maxIterations` | Chamadas ao modelo por item (padrão 10). O teto da instalação (`OLLY_AGENT_MAX_ITERATIONS`, 25) prevalece |
| `returnIntermediateSteps` | Inclui na saída as ferramentas chamadas e os resultados |
| `outputParser` | `none` (texto) ou `jsonSchema`: a resposta precisa ser um JSON válido no `schema` |
| `schema` | JSON Schema da resposta estruturada (`outputParser: jsonSchema`) |
| `blockToolCallsAfterUntrustedContent` | Depois do primeiro resultado de ferramenta externa (MCP ou HTTP), toda ferramenta com efeito colateral passa a pedir aprovação humana (padrão desligado) |

## Saída (um item por item de entrada)

```json
{
  "output": "texto da resposta (ou o objeto, com outputParser jsonSchema)",
  "intermediateSteps": [{ "action": { "tool": "consulta_cliente", "toolInput": { "id": "1" } }, "observation": "..." }],
  "usage": { "inputTokens": 812, "outputTokens": 95, "model": "gpt-4o-mini" }
}
```

`intermediateSteps` só com `returnIntermediateSteps`.

## Comportamento

- **Sub-nós (FR-001):** modelo, memória e ferramentas se conectam na base do Agent e não executam no fluxo principal. As expressões dos sub-nós enxergam o item atual do Agent (ex.: `{{ $json.sessionId }}` na memória). O salvamento recusa Agent sem modelo (`AGENT_MODEL_REQUIRED`), com mais de uma memória (`AGENT_MEMORY_MAX`), sub-nó ligado ao fluxo (`SUBNODE_ON_MAIN`) e ferramentas com nome inválido, repetido ou sem descrição.
- **Limite de iterações (FR-003):** ao atingir o limite sem resposta final, o nó falha com `O agente atingiu o limite de N iterações sem uma resposta final`.
- **Resposta estruturada (FR-004):** resposta inválida volta ao modelo com os erros para correção, até 2 vezes; depois, o nó falha (`... após 2 correções`).
- **Passos (FR-006):** cada chamada ao modelo, chamada de ferramenta, decisão de aprovação e resposta final é gravada (mascarada) e enviada ao vivo ao editor (evento `agentStep`), no painel do nó, em "Passos do agente". O conteúdo só aparece para quem tem `execution:readData`.
- **Resultados de ferramenta (FR-012):** truncados em `OLLY_AGENT_TOOL_RESULT_MAX_CHARS` (20 000) e entregues ao modelo dentro de `<tool_result source="..." untrusted="true">`, com a instrução de não seguir ordens contidas neles.
- **Aprovação humana (FR-010, FR-011):** ferramenta com `requireApproval`, tool MCP marcada como destrutiva ou (com `blockToolCallsAfterUntrustedContent`) ferramenta com efeito colateral após conteúdo externo: a execução pausa (`waiting`), o pedido aparece em **Aprovações** para quem tem `workflow:execute` no projeto, e a decisão retoma a execução (inclusive em outro worker). Rejeitada, o agente recebe `Ação rejeitada pelo usuário: <comentário>` como resultado e continua. Prazo: `OLLY_APPROVAL_TIMEOUT_HOURS` (24 h); vencido, conta como rejeição. Cancelar a execução cancela os pedidos.
- **Memória (FR-009):** com uma memória conectada, o histórico da sessão vai antes do pedido, e o pedido e a resposta final são guardados ao fim.
- **Uso e limite (FR-014, FR-015):** cada chamada ao modelo registra tokens e custo estimado (tabela de preços). Com limite mensal de tokens no projeto, a chamada que o ultrapassaria falha com `Limite mensal de tokens do projeto atingido`.
- **Vários itens:** cada item é uma conversa independente; os itens prontos são mantidos se outro pausar para aprovação.

## Divergências do N8N

- Ferramentas MCP só de servidores aprovados no catálogo, com tools liberadas por projeto (spec 010).
- A ferramenta PostgreSQL não aceita SQL do modelo: o SQL é fixo e o modelo só preenche os parâmetros (`$fromAI`).
- Aprovação humana embutida, com auditoria; no N8N, isso exige montar o fluxo à mão.
- Sem os agentes "Conversational", "Plan and Execute" e similares: só o agente de ferramentas.

Introduzido na [spec 011](../../specs/011-ai-agent/spec.md) (FR-001, FR-003 a FR-006, FR-010 a FR-015).
