# Ferramentas do agente (`tool.*`)

Sub-nós conectados à porta **Ferramentas** do [Agente de IA](ai.agent.md). Cada ferramenta vira uma função que o modelo pode chamar, com nome, descrição e schema de argumentos. Equivalem às "Tools" do N8N.

| Tipo | Nó | Efeito colateral | Conteúdo externo |
|---|---|---|---|
| `tool.mcp` | Ferramenta: MCP | Tools sem a anotação `readOnlyHint` | Sim |
| `tool.httpRequest` | Ferramenta: HTTP | Métodos diferentes de GET/HEAD | Sim |
| `tool.postgresQuery` | Ferramenta: PostgreSQL | SQL que não começa com `SELECT`, `WITH`, `SHOW` ou `EXPLAIN` | Não |
| `tool.workflow` | Ferramenta: workflow | Sim | Não |
| `tool.code` | Ferramenta: código | Sim | Não |

"Efeito colateral" e "conteúdo externo" alimentam o `blockToolCallsAfterUntrustedContent` do Agent (FR-013).

## Parâmetros comuns (exceto `tool.mcp`)

| Parâmetro | Descrição |
|---|---|
| `toolName` | Nome para o modelo: letras, números, `_` e `-` (até 64). Vazio: o nome do nó normalizado. Único no Agent |
| `toolDescription` | O que a ferramenta faz e quando usá-la (obrigatória: é o que o modelo lê) |
| `requireApproval` | Cada chamada pausa a execução até alguém aprovar ou rejeitar (FR-010) |

## `$fromAI` (FR-007)

Nos parâmetros das ferramentas HTTP e PostgreSQL, `{{ $fromAI('chave', 'descrição', 'tipo', padrão) }}` marca um valor que o **modelo** fornece. O schema de argumentos da ferramenta é gerado das ocorrências (`tipo`: `string`, padrão, `number`, `boolean` ou `json`); na chamada, cada ocorrência recebe o argumento do modelo. Ex.: na URL, `https://api.interna/clientes/{{ $fromAI('id', 'Id do cliente') }}`.

O campo precisa estar no modo **Expressão** (alternador "Fixo / Expressão" do campo); em modo Fixo o texto vai literal e não vira argumento. O formulário da Ferramenta: HTTP mostra os exemplos abaixo de "Parâmetros de query" e de "JSON":

- URL: `https://api.exemplo.com/clientes/{{ $fromAI('id', 'Id do cliente') }}`
- Parâmetro de query: Nome `cidade`, Valor `{{ $fromAI('cidade', 'Nome da cidade') }}`
- Corpo JSON: `{ "cidade": "{{ $fromAI('cidade', 'Nome da cidade') }}", "dias": {{ $fromAI('dias', 'Quantidade de dias', 'number', 3) }} }` (`dias` tem padrão, então é opcional para o modelo)

## Por ferramenta

- **`tool.mcp`:** `serverId` (servidor ativo do catálogo) e `tools` (`allowed`: todas as liberadas no projeto; `selected`: só as de `toolNames`). Gera uma ferramenta por tool MCP liberada, com o `inputSchema` aprovado (snapshot). Tools marcadas como destrutivas na política exigem aprovação. Valem a validação, o bloqueio por mudança e o registro em `mcp_calls` da [spec 010](../mcp-governanca.md) (com o id do sub-nó).
- **`tool.httpRequest`:** os parâmetros do [`http.request`](http.request.md) (credencial, filtro anti-SSRF, limite de resposta), com `$fromAI` onde o modelo decide.
- **`tool.postgresQuery` (FR-008):** `query` fixa, sem expressão (o salvamento recusa `$fromAI` ou qualquer expressão no SQL), e `queryParameters` (`$1`, `$2`...) com `$fromAI`. O modelo nunca escreve SQL. Use uma credencial `readOnly` sempre que possível.
- **`tool.workflow`:** chama um workflow publicado com o gatilho "Quando chamado por outro workflow" ([spec 008](trigger.executeWorkflow.md)) e devolve a saída do último nó. O schema de argumentos vem do schema de entrada do gatilho (sem schema: `{ query: string }`). Vale a regra de permissão e profundidade dos sub-workflows.
- **`tool.code`:** `inputSchema` (JSON Schema dos argumentos) e `jsCode`, executado no sandbox do [nó de código](code.javascript.md); os argumentos estão em `$input.first().json`. O formulário mostra um exemplo abaixo de cada campo: o schema declara o que o modelo envia (a `description` de cada propriedade orienta o modelo) e o código usa esses argumentos e devolve o resultado.

  ```json
  {"type":"object","properties":{"valor":{"type":"number","description":"Valor da compra em reais"},"parcelas":{"type":"integer","description":"Número de parcelas"}},"required":["valor","parcelas"]}
  ```

  ```js
  const { valor, parcelas } = $input.first().json;
  return { parcela: Number((valor / parcelas).toFixed(2)) };
  ```

## Resultado

O resultado (os `json` dos itens; um só, sem lista) é truncado em `OLLY_AGENT_TOOL_RESULT_MAX_CHARS` e entregue ao modelo como conteúdo não confiável. Erro da ferramenta volta ao modelo como `Erro da ferramenta: <mensagem>` (o agente pode tentar de outro jeito).

## Divergências do N8N

- Sem ferramenta "Text-to-SQL": o SQL é sempre fixo.
- MCP só do catálogo aprovado.
- `requireApproval` em qualquer ferramenta.

Introduzido na [spec 011](../../specs/011-ai-agent/spec.md) (FR-007, FR-008, FR-010, FR-013).
