# Definir variável (`data.setVariable`)

Grava variáveis da execução, lidas pelos nós seguintes em `$vars`, e repassa os itens sem alteração.

| Item | Valor |
|---|---|
| Categoria | Dados |
| Entradas | `main` |
| Saídas | `main` |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `variables[]` | Lista de `{ name, value }`. `value` aceita expressões e qualquer tipo de resultado |

## Comportamento

- Com vários itens de entrada, as variáveis são avaliadas item a item, em ordem; o último valor prevalece.
- As variáveis valem só para a execução atual. Os nós seguintes leem o valor vigente quando executam.
- Nome vazio é erro.
- Ao executar um único nó adiante no editor, este nó roda de novo em vez de reaproveitar a saída anterior (`rerunOnPartialExecution`), para que `$vars` chegue aos nós seguintes. Os nós depois dele continuam reaproveitados ([spec 003](../../specs/003-expressoes-execucao-teste/spec.md), FR-020).

## Divergência do N8N

No N8N, `$vars` são variáveis globais da instância, somente leitura. No Olly Flow, são variáveis da execução (ADR-0001). Introduzido na [spec 003](../../specs/003-expressoes-execucao-teste/spec.md) (FR-009).
