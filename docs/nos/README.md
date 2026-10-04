# Nós do Olly Flow

Cada nó vive em `packages/nodes/src/<categoria>/<nome>/` (`definition.ts`, `execute.ts`, testes) e é registrado em `packages/nodes/src/builtin.ts`. O registro (`NodeRegistry`) recusa nós com definição inválida, e o teste do registro valida todos os nós da plataforma.

| Tipo | Nó | Spec | Página |
|---|---|---|---|
| `trigger.manual` | Gatilho manual | 002 | [trigger.manual.md](trigger.manual.md) |
| `data.set` | Definir campos | 002 (expressões: 003) | [data.set.md](data.set.md) |
| `data.setVariable` | Definir variável | 003 | [data.setVariable.md](data.setVariable.md) |
| `logic.if` | Se (If) | 003 | [logic.if.md](logic.if.md) |

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
| `x-secret` | Marca um valor sensível (uso a partir da spec 004). |
| `x-hidden` | Parâmetro aceito, mas não exibido no editor (ex.: aliases legados). |

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

Qualquer parâmetro string pode ser uma expressão (`=...`), inclusive dentro de listas e objetos; o editor oferece o alternador **Fixo | Expressão** em todo campo escalar. O nó recebe o valor já resolvido para cada item via `ctx.getParam(nome, índice)`. Ver [docs/expressoes.md](../expressoes.md).

## Comportamentos comuns a todos os nós

- **Nó desabilitado:** repassa a primeira entrada para a primeira saída, sem executar (como no N8N).
- **Dados fixados (pin data):** o nó emite os itens fixados na primeira saída e não executa.
- **`pairedItem`:** nós que não informam a origem de cada item recebem-na automaticamente quando ela é inequívoca (um item de entrada, ou mesma quantidade de itens). Nós que filtram ou reordenam (If) devem preenchê-la.
- **Ramo sem itens:** o nó não executa e propaga "sem dados" para os seguintes.
- **Nome:** único no workflow. Ao colar, nomes repetidos ganham sufixo numérico (`Definir campos1`).
