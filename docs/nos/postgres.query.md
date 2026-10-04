# PostgreSQL: consulta (`postgres.query`)

Executa SQL parametrizado num banco PostgreSQL; cada linha do resultado vira um item. Equivale à operação *Execute Query* do `n8n-nodes-base.postgres`.

| Item | Valor |
|---|---|
| Categoria | Integração |
| Entradas | `main` |
| Saídas | `main` |
| Credenciais | `postgres` |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `query` | SQL com parâmetros posicionais (`$1`, `$2`...). **Não aceita expressões** |
| `queryParameters[]` | Lista de `{ value }`, na ordem (o primeiro é `$1`). Os valores aceitam expressões |
| `mode` | `once` (padrão: uma vez, com os parâmetros do 1º item) ou `perItem` (uma vez por item) |
| `options.maxRows` | Máximo de linhas (padrão 1000) |
| `options.statementTimeoutMs` | Timeout do comando (padrão 30 000 ms) |

## Comportamento

- **SQL sem expressão:** um `query` iniciado por `=` é recusado ao salvar o workflow e na execução. Valores entram só como parâmetros e são sempre tratados como dados (`'; DROP TABLE x; --` é um texto como outro qualquer).
- Cada execução roda numa transação com `statement_timeout` local. Com a credencial **somente leitura**, a transação é `READ ONLY` e comandos de escrita falham.
- **`maxRows`:** o resultado é lido por cursor; acima do limite, as linhas extras são descartadas e um aviso vai para o log da execução.
- Comando sem linhas de retorno (ex.: `INSERT` sem `RETURNING`) devolve um item `{ success: true }`.
- **`pairedItem`:** o item de origem (`perItem`) ou o item 0 (`once`).
- **Timeout e cancelamento** cancelam a consulta no servidor (`pg_cancel_backend`).
- **`onError: continue`** (modo por item): o item que falha vira `{ json: { error: { message, description } } }`; `description` traz o `SQLSTATE`.
- **Conexões:** pool por credencial (`OLLY_PG_POOL_MAX`, padrão 5). Alterar a credencial cria um pool novo; pools ociosos são fechados.

## Divergências do N8N

- O N8N aceita expressões no texto SQL; aqui é proibido (constituição III.2, FR-012).

Introduzido na [spec 004](../../specs/004-credenciais-http-postgres/spec.md) (FR-011 a FR-013).
