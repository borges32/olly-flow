# Loop em lotes (`logic.loopOverItems`)

Processa muitos itens em lotes de tamanho fixo. É compatível com o Split in Batches v3 (Loop Over Items) do N8N, inclusive na ordem das saídas.

| Item | Valor |
|---|---|
| Categoria | Lógica |
| Entradas | `main`, `continue` (Continuar) |
| Saídas | `done` (Concluído), `loop` (Lote) |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `batchSize` | Tamanho do lote (padrão 10) |

## Comportamento

- **Primeiro lote:** sai em `loop`. O corpo processa o lote e volta pela entrada Continuar.
- **A cada volta:** os itens recebidos são acumulados e sai o próximo lote.
- **Sem lotes restantes:** `done` recebe todos os itens que voltaram, na ordem.
- **Sem itens de entrada:** termina direto, com `done` vazio.
- **Variáveis:** `$loop.index` é o número de lotes concluídos; `$loop.maxIterations`, o total de lotes.
- **Validação e iterações:** a regra de ciclos e o registro das iterações são os mesmos do [While](logic.while.md).

Introduzido na [spec 007](../../specs/007-controle-de-fluxo/spec.md) (FR-011).
