# Nós do Olly Flow

Cada nó vive em `packages/nodes/src/<categoria>/<nome>/` (`definition.ts`, `execute.ts`, testes) e é registrado em `packages/nodes/src/builtin.ts`. O registro (`NodeRegistry`) recusa nós com definição inválida, e o teste do registro valida todos os nós da plataforma.

| Tipo | Nó | Spec | Página |
|---|---|---|---|
| `trigger.manual` | Gatilho manual | 002 | [trigger.manual.md](trigger.manual.md) |
| `data.set` | Definir campos | 002 (expressões: 003) | [data.set.md](data.set.md) |
| `data.setVariable` | Definir variável | 003 | [data.setVariable.md](data.setVariable.md) |
| `logic.if` | Se (If) | 003 | [logic.if.md](logic.if.md) |
| `http.request` | Requisição HTTP | 004 | [http.request.md](http.request.md) |
| `postgres.query` | PostgreSQL: consulta | 004 | [postgres.query.md](postgres.query.md) |
| `postgres.write` | PostgreSQL: gravar | 004 | [postgres.write.md](postgres.write.md) |
| `trigger.webhook` | Webhook | 005 | [trigger.webhook.md](trigger.webhook.md) |
| `http.respondToWebhook` | Responder ao webhook | 005 | [http.respondToWebhook.md](http.respondToWebhook.md) |
| `code.javascript` | Código (JavaScript) | 005 | [code.javascript.md](code.javascript.md) |

Os nós de integração recebem as dependências da API por `createBuiltinNodes({ httpGuard, httpMaxResponseBytes, pools })`: filtro anti-SSRF com a allowlist, limite de resposta e pools Postgres. Credenciais: [docs/credenciais.md](../credenciais.md).

## Convenções de `paramsSchema`

O `paramsSchema` é um **JSON Schema draft-07** com `type: "object"` na raiz. Ele gera o painel de parâmetros do editor e é validado com ajv em modo estrito: palavras-chave desconhecidas (inclusive erros de digitação) fazem o registro do nó falhar.

### Subconjunto suportado pelo painel

| Schema | Campo no painel |
|---|---|
| `type: "string"` | Texto |
| `type: "string"` + `enum` | Lista de opções |
| `type: "number"` / `"integer"` | Número |
| `type: "boolean"` | Caixa de seleção |
| `type: "object"` com `properties` | Grupo de campos |
| `type: "array"` com `items` do tipo objeto | Lista de linhas, com Adicionar e Remover |

Use `title` (rótulo), `description` (ajuda abaixo do campo) e `default` (valor inicial ao adicionar o nó ou a linha). Outros formatos aparecem como "não suportado"; amplie o painel na spec que precisar deles.

### Extensões

| Palavra-chave | Uso |
|---|---|
| `x-display-options` | Exibição condicional, equivalente ao `displayOptions` do N8N: `{ "show": { "campo": [valores] }, "hide": { "campo": [valores] } }`. Os campos citados são **irmãos** no mesmo objeto. O campo aparece quando todas as condições de `show` batem e nenhuma de `hide`. Um irmão sem valor usa o `default` do seu schema. |
| `x-secret` | Marca um valor sensível. Nos tipos de credencial, o campo nunca sai da API e é mascarado nos dados de execução (spec 004). |
| `x-hidden` | Parâmetro aceito, mas não exibido no editor (ex.: aliases legados). |
| `x-no-expression` | Campo sem modo expressão: o editor não oferece o alternador e o salvamento recusa valor iniciado por `=` (erro `EXPRESSION_NOT_ALLOWED`). Ex.: SQL do `postgres.query` (spec 004). |
| `x-multiline` | Área de texto em vez de linha única (spec 004). |
| `x-code-editor` | Campo editado no editor de código (Monaco), com autocomplete das variáveis e dos nós. Valor: a linguagem (`javascript`) (spec 005). |
| `x-load-options` | Opções buscadas no catálogo do banco da credencial do nó: `postgresSchemas`, `postgresTables` (do `schema` irmão) ou `postgresColumns` (de `schema` e `table`). Sem credencial, o campo vira texto (spec 004). |

Exemplo:

```json
{
  "type": "object",
  "properties": {
    "modo": { "type": "string", "enum": ["simples", "avancado"], "default": "simples" },
    "limite": {
      "type": "number",
      "title": "Limite",
      "x-display-options": { "show": { "modo": ["avancado"] } }
    }
  }
}
```

## Expressões nos parâmetros

Qualquer parâmetro string pode ser uma expressão (`=...`), inclusive dentro de listas e objetos, exceto os marcados com `x-no-expression`; o editor oferece o alternador **Fixo | Expressão** nos demais campos escalares. O nó recebe o valor já resolvido para cada item via `ctx.getParam(nome, índice)`. Ver [docs/expressoes.md](../expressoes.md).

## Comportamentos comuns a todos os nós

- **Nó desabilitado:** repassa a primeira entrada para a primeira saída, sem executar (como no N8N).
- **Dados fixados (pin data):** o nó emite os itens fixados na primeira saída e não executa.
- **`pairedItem`:** nós que não informam a origem de cada item recebem-na automaticamente quando ela é inequívoca (um item de entrada, ou mesma quantidade de itens). Nós que filtram ou reordenam (If) devem preenchê-la.
- **Ramo sem itens:** o nó não executa e propaga "sem dados" para os seguintes.
- **Nome:** único no workflow. Ao colar, nomes repetidos ganham sufixo numérico (`Definir campos1`).

## Configurações do nó (spec 004)

Aba **Configurações** do painel do nó, gravada em `node.settings`:

| Configuração | Efeito |
|---|---|
| `retry` `{ maxTries (1–10), waitMs (0–60 000), backoff: fixed \| exponential }` | Executa o nó de novo após falha; no exponencial, a espera dobra a cada tentativa (`waitMs * 2^n`). As tentativas ficam em `node_executions.attempts` |
| `timeoutMs` | Aborta o nó após o tempo; o sinal (`ctx.signal`) interrompe a operação HTTP ou SQL em andamento |
| `onError` | `stop` (padrão): falha a execução. `continue`: o nó emite `{ json: { error: { message, description?, httpCode? } } }` e o fluxo segue. Os nós HTTP e Postgres tratam o erro por item (o item que falha vira o item de erro). `errorOutput` fica para a spec 007 |
