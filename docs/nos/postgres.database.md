# PostgreSQL (`postgres.database`)

Consulta, seleciona, insere, atualiza, faz upsert ou exclui registros num banco PostgreSQL. Equivale ao nó **Postgres** do N8N (`n8n-nodes-base.postgres` 2.x), com as mesmas operações. Produzido pela [spec 022](../../specs/022-postgres-no-unico/spec.md), substitui os nós "PostgreSQL: consulta" (`postgres.query`) e "PostgreSQL: gravar" (`postgres.write`) da spec 004.

| Item        | Valor      |
| ----------- | ---------- |
| Categoria   | Integração |
| Entradas    | `main`     |
| Saídas      | `main`     |
| Credenciais | `postgres` |

## Operações

| `operation`    | No N8N           | O que faz                                                                           |
| -------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `executeQuery` | Execute Query    | SQL parametrizado (`$1`, `$2`…); cada linha vira um item                            |
| `select`       | Select           | Linhas da tabela por condições, ordenação e limite                                  |
| `insert`       | Insert           | Insere os itens (mapeamento automático ou manual de colunas)                        |
| `update`       | Update           | Atualiza pelas colunas de correspondência                                           |
| `upsert`       | Insert or Update | Insere ou atualiza pelas colunas de correspondência                                 |
| `deleteTable`  | Delete           | Exclui linhas por condições, esvazia (`TRUNCATE`) ou remove (`DROP TABLE`) a tabela |

O painel mostra só os campos da operação escolhida. Os parâmetros completos estão no [catálogo do formato](workflow-json.md#postgresdatabase--postgresql).

## Executar consulta, inserir, atualizar e upsert

São as mesmas regras da spec 004:

- o SQL não aceita expressão; os valores entram só como parâmetros;
- modo uma vez ou por item;
- mapeamento de colunas, colunas de correspondência, lotes, transação "tudo ou nada", colunas devolvidas e "ignorar conflitos";
- limite de linhas e timeout do comando.

As opções ficam em `queryOptions` (consulta) e `writeOptions` (gravação).

## Selecionar

- **Condições:** coluna, operador e valor (aceita expressão), combinadas com E ou OU. Operadores: `equal`, `!=`, `LIKE`, `>`, `<`, `>=`, `<=`, `IS NULL`, `IS NOT NULL`.
- **Ordenação:** colunas com `ASC` ou `DESC`.
- **Limite:** padrão 50, ou **todas as linhas**.
- **Execução:** uma consulta por item de entrada, e cada linha vira um item.

## Excluir

| `deleteCommand`   | Comando                                                                                                    | Saída                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `delete` (padrão) | `DELETE FROM … WHERE <condições>`, uma vez por item. **Sem condições, apaga todas as linhas**, como no N8N | As linhas excluídas                                           |
| `truncate`        | `TRUNCATE TABLE …`, com **Reiniciar sequências** (`RESTART IDENTITY`) e **Em cascata** (`CASCADE`)         | `{ "success": true, "command": "TRUNCATE TABLE …" }` por item |
| `drop`            | `DROP TABLE …`, com **Em cascata**                                                                         | `{ "success": true, "command": "DROP TABLE …" }` por item     |

O `truncate` e o `drop` rodam **uma vez por execução do nó**, mesmo com vários itens; no N8N, rodariam por item, e o `DROP` falharia do segundo item em diante. O comando executado fica na saída e no log da execução. O padrão aqui é `delete`; no N8N, é `truncate` (a importação mantém o comando do N8N).

## Sem linhas no resultado

Como no N8N, quando não volta nenhuma linha, a saída é `{ "success": true }`, vinculada ao item de entrada, e o fluxo segue. Exemplos: um `delete` que não atingiu linhas, um `select` vazio, um SQL sem `RETURNING` ou um `update` sem correspondência. No `select` e no `delete`, vale por item; nas gravações em lote, quando nenhuma linha volta. Os dados do item de entrada não passam adiante (a saída é o resultado do banco); nos nós seguintes, use `$('Nó anterior').item.json`. Para parar o fluxo quando não houver linhas, use um If depois do nó (ex.: `{{ $json.success }}` é verdadeiro).

## Segurança

- **Tabelas e colunas:** são conferidas no catálogo do banco antes de qualquer comando, e os nomes vão entre aspas.
- **Valores:** vão sempre como parâmetros, nunca concatenados ao SQL.
- **Credencial em modo somente leitura:** a transação é `READ ONLY`, então inserir, atualizar, upsert e excluir são recusados pelo banco.
- **Erros:** com "continuar" ou "saída de erro", o item que falha vira item de erro (spec 004 e spec 007), sem parar os demais.

## Workflows anteriores

Os nós `postgres.query` e `postgres.write` são convertidos para este nó ao ler, salvar, executar e importar arquivos do Olly Flow. As versões publicadas não são reescritas, e o resultado é o mesmo:

- **consulta:** `operation: "executeQuery"`, com as opções em `queryOptions`;
- **gravação:** a mesma operação, com as opções em `writeOptions`.

## Importação do N8N

Todas as operações do Postgres 2.x são convertidas, e as opções sem equivalente aparecem como pendências: colunas de saída, números grandes e substituir strings vazias. Do Postgres v1, só o Execute Query é convertido; as demais operações viram nós marcadores. Ver [docs/importacao-n8n.md](../importacao-n8n.md).
