# Juntar (`logic.merge`)

Combina os itens de vários ramos. Equivale ao `n8n-nodes-base.merge` v3, com **2 a 10 entradas**. O N8N tem só 2; essa divergência está prevista na [ADR-0001](../adr/0001-abordagem-hibrida.md).

| Item | Valor |
|---|---|
| Categoria | Lógica |
| Entradas | `input1` … `inputN` (Entrada 1…N), conforme `numberInputs` |
| Saídas | `main` |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `mode` | Modo de junção (padrão `append`, ver abaixo) |
| `numberInputs` | Número de entradas, de 2 a 10 (padrão 2). Fora da faixa, o editor avisa e o salvamento recusa (`PARAM_OUT_OF_RANGE`). Reduzir pede confirmação no editor e remove as conexões das entradas que deixam de existir |
| `includeUnpaired` | No modo `combineByPosition`: inclui os itens sem par (padrão `false`) |
| `fields[]` | No modo `combineByFields`: `{ input1Field, input2Field }`. Aceita notação de ponto (`cliente.cpf`); vários pares formam uma chave composta |
| `joinMode` | No modo `combineByFields`: `inner`, `left`, `outer` ou `keepNonMatches` |
| `output` / `chosenInput` | No modo `chooseBranch`: a entrada escolhida, ou `empty` (um item vazio) |
| `clashHandling` | Campo presente em mais de uma entrada (padrão `preferLast`, ver abaixo) |
| `waitFor` | Como tratar as entradas vazias (padrão `allConnected`, ver abaixo) |

### Modos (`mode`)

| Modo | O que faz |
|---|---|
| `append` | Concatena as entradas, na ordem 1, 2, 3… |
| `combineByPosition` | Junta os campos (`merge` raso de `json`) pela posição do item |
| `combineByFields` | Join por campo; só com 2 entradas |
| `chooseBranch` | Emite os itens de uma entrada |
| `waitAll` | Espera todas as entradas e emite a entrada 1 |

### Campos repetidos (`clashHandling`)

| Valor | Resultado |
|---|---|
| `preferInput1` | Vale o valor da entrada 1 |
| `preferLast` | Vale o valor da última entrada |
| `addSuffix` | Renomeia os campos repetidos com o número da entrada (`id_1`, `id_2`) |

### Entradas vazias (`waitFor`)

| Valor | Resultado |
|---|---|
| `allConnected` | Entradas sem dados entram como lista vazia |
| `anyWithData` | Usa só as entradas com dados |

## Comportamento

- **Quando executa:**
  - fora de laços, o Merge executa **uma vez**, depois que todas as entradas conectadas foram resolvidas, com ou sem dados;
  - se todas vierem sem dados, o nó é pulado;
  - dentro do corpo de um laço, executa uma vez por iteração.
- **Join:** usa um índice hash pela chave, em O(n + m). Campo ausente ou nulo nunca casa. A ordem segue a entrada 1 e, para cada item dela, os pares na ordem da entrada 2.
- **`pairedItem`:** indica a entrada de origem (`{ item, input }`).

Introduzido na [spec 007](../../specs/007-controle-de-fluxo/spec.md) (FR-001–FR-004).
