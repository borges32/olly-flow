# Roteador (`logic.switch`)

Encaminha cada item para uma de várias saídas. Equivale ao `n8n-nodes-base.switch` v3.

| Item | Valor |
|---|---|
| Categoria | Lógica |
| Entradas | `main` |
| Saídas | `output0` … `outputN-1` (uma por regra, com o nome da regra) e `fallback` (Padrão), opcional |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `mode` | `rules` (regras) ou `expression` (índice calculado) |
| `rules[]` | `{ conditions, outputKey }`. As condições têm o mesmo formato e as mesmas operações do [If](logic.if.md); `outputKey` dá nome à saída |
| `looseTypeValidation` | Conversão flexível de tipos (como no If) |
| `options.fallbackOutput` | Itens sem regra verdadeira: `none` (descarta), `extra` (saída **Padrão**) ou o número de uma saída |
| `options.allMatchingOutputs` | Envia o item a todas as regras verdadeiras, não só à primeira |
| `numberOutputs` | Modo expressão: número de saídas (1–20) |
| `output` | Modo expressão: expressão que devolve o índice da saída (0, 1, 2...) por item. Fora do intervalo é erro |

## Comportamento

- **Regras:** são avaliadas por item, em ordem.
- **Saídas:** as saídas sem itens não executam os nós ligados a elas.
- **Portas:** o editor recalcula as portas quando as regras mudam. Remover uma regra conectada pede confirmação.

Introduzido na [spec 007](../../specs/007-controle-de-fluxo/spec.md) (FR-012).
