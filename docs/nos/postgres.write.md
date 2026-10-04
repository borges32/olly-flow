# PostgreSQL: gravar (`postgres.write`)

Insere, atualiza ou faz upsert de registros a partir dos itens. Equivale às operações *Insert*, *Update* e *Insert or Update* do `n8n-nodes-base.postgres`.

| Item | Valor |
|---|---|
| Categoria | Integração |
| Entradas | `main` |
| Saídas | `main` |
| Credenciais | `postgres` |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `operation` | `insert` (padrão), `update` ou `upsert` |
| `schema`, `table` | Escolhidos em listas carregadas do banco da credencial. Não aceitam expressões |
| `columns.mappingMode` | `autoMap` (padrão: cada campo do item vai para a coluna de mesmo nome) ou `defineBelow` (`columns.values[]`: `{ column, value }`, valores com expressões) |
| `matchingColumns[]` | Colunas que identificam a linha no `update` e o conflito no `upsert` |
| `options.transaction` | `none` (padrão) ou `allItems` (tudo ou nada) |
| `options.batchSize` | Linhas por comando no insert e no upsert (padrão 100) |
| `options.returning` | `*` (padrão), colunas separadas por vírgula, ou vazio para repassar os itens de entrada |
| `options.skipOnConflict` | Insert com `ON CONFLICT DO NOTHING` |
| `options.statementTimeoutMs` | Timeout de cada comando (padrão 30 000 ms) |

## Comportamento

- **Identificadores validados:** schema, tabela e colunas (do mapeamento, de correspondência e de retorno) precisam existir em `information_schema` (cache de 60 s) e são escapados. Campo do item sem coluna correspondente é erro.
- **Insert:** multi-linha por lote; colunas ausentes num item recebem `DEFAULT`.
- **Update:** um comando por item (`SET` com as colunas que não são de correspondência, `WHERE` com as de correspondência).
- **Upsert:** `INSERT ... ON CONFLICT (colunas de correspondência) DO UPDATE SET ...` (ou `DO NOTHING`, se só houver colunas de correspondência).
- **`transaction: allItems`:** uma transação única; qualquer falha desfaz todos os itens.
- **`transaction: none`:** cada lote (ou item, no update) em sua própria transação. Com `onError: continue`, os itens são gravados um a um e o que falha vira `{ json: { error } }`.
- Credencial **somente leitura**: o comando falha.
- Valores são sempre parâmetros (`$n`).

Introduzido na [spec 004](../../specs/004-credenciais-http-postgres/spec.md) (FR-014 a FR-016).
