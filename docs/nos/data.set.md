# Definir campos (`data.set`)

Define ou altera campos dos itens com valores tipados. Equivale ao `n8n-nodes-base.set` (*Edit Fields*).

| Item | Valor |
|---|---|
| Categoria | Dados |
| Entradas | `main` |
| Saídas | `main` |

## Parâmetros

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `fields` | lista de `{ name, type, value }` | `[]` | Campos a definir, na ordem |
| `fields[].name` | texto | — | Nome do campo. Notação de ponto cria campos aninhados: `cliente.endereco.cidade` |
| `fields[].type` | `string` \| `number` \| `boolean` \| `json` | `string` | Tipo do valor |
| `fields[].value` | texto | `""` | Valor, convertido para o tipo |
| `includeOtherFields` | booleano | `false` | Inclui os demais campos (e binários) do item de entrada. Desligado, a saída tem só os campos definidos (padrão do N8N atual) |
| `keepOnlySet` | booleano | — | **Legado (spec 002)**, oculto no editor: `keepOnlySet: false` equivale a `includeOtherFields: true`. Vale só quando `includeOtherFields` não está definido |

## Conversão de tipos

| Tipo | Aceita | Erro |
|---|---|---|
| `string` | Qualquer valor | — |
| `number` | Número ou texto numérico (`"34"`, `"1.5"`) | Texto vazio ou não numérico |
| `boolean` | `true`/`false` ou `"true"`/`"false"` (sem diferenciar maiúsculas) | Qualquer outro valor |
| `json` | Texto JSON (`{"a":1}`, `[1,2]`) | JSON inválido |

O erro cita o campo: `Parâmetro "idade": valor "abc" não é um número`.

## Comportamento

- Processa cada item de entrada e preenche `pairedItem` com o índice do item de origem.
- Não altera o item de entrada: trabalha sobre uma cópia.
- Todos os parâmetros aceitam expressões ([docs/expressoes.md](../expressoes.md)); o resultado é convertido pelo tipo do campo (ex.: `={{ $json.idade }}` com tipo `string` vira `"34"`).

## Exemplo

Entrada `[{ "json": { "id": 7 } }]` com `includeOtherFields: true` e `fields = [{ "name": "cliente.nome", "type": "string", "value": "Ana" }]` produz `[{ "json": { "id": 7, "cliente": { "nome": "Ana" } }, "pairedItem": { "item": 0 } }]`.

## Compatibilidade com o N8N

Equivalente ao Set v3.3+ com notação de ponto ligada; "Include Other Input Fields" é `includeOtherFields`. Introduzido na [spec 002](../../specs/002-editor-workflows-rbac/spec.md) (FR-018); expressões e `includeOtherFields` na [spec 003](../../specs/003-expressoes-execucao-teste/spec.md) (FR-008).

> **Mudança de padrão na spec 003:** nós sem `includeOtherFields` nem `keepOnlySet` passam a manter só os campos definidos. Workflows salvos pelo editor da spec 002 têm `keepOnlySet: false` e continuam incluindo os demais campos.
