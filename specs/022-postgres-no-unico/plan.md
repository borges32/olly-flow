# Plano técnico — Spec 022: Nó PostgreSQL único, com excluir e selecionar

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Nó `postgres.database` ("PostgreSQL")** com `operation` e campos condicionais (`x-display-options`).
  - **Reaproveitamento:** executar consulta, inserir, atualizar e upsert chamam os executores atuais (`executePostgresQuery`, `executePostgresWrite`), com as opções lidas de `queryOptions` e `writeOptions`.
  - **Novo:** `select` e `deleteTable` têm executores próprios, com a mesma base (`inTransaction`, catálogo de colunas, `quoteIdent`, erros por item).
- **Paleta e consulta do Agent:** `postgres.query` e `postgres.write` saem da paleta. O `createPostgresQueryNode` continua existindo para a ferramenta `tool.postgresQuery` (FR-010).
- **Migração:** `migrateLegacyPostgres` (`@olly/shared-types`), dentro de `migrateLegacyDefinition`, que já roda nas entradas da API, nas leituras do banco (`readDefinition`) e em `fromWorkflowFile` (spec 018).
- **Importador do N8N:** o conversor do Postgres passa a gerar `postgres.database`, com o `select` e o `deleteTable` novos.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| II — Compatibilidade com o N8N | Mesmos nomes de operações, condições, comandos e opções do Postgres 2.x; importação 1:1 |
| III — Segurança | Identificadores conferidos no catálogo e entre aspas; valores só como `$n`; transação somente leitura com a credencial em modo leitura; nenhuma rota nova |
| IV — Testes | Integração com PostgreSQL real (Testcontainers) para seleção, exclusão e migração; unidade para a montagem do SQL, a migração e o conversor |
| VIII — Privacidade e observabilidade | `TRUNCATE` e `DROP` deixam `{ success, command }` na saída, gravada no log da execução |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/shared-types` | `legacy-postgres.ts` (`migrateLegacyPostgres`) e a inclusão em `migrateLegacyDefinition` |
| `packages/nodes` | `postgres/database/` (definição, `select.ts`, `delete.ts`, `conditions.ts`); `ColumnCache.invalidate`; `builtin.ts` (sai `postgres.query`/`postgres.write`, entra `postgres.database`) |
| `apps/api` | Conversor do Postgres no importador do N8N; testes com os tipos antigos passam pela migração |
| `apps/web` | Ícone; E2E de integrações pelo nó único |
| `docs/` | `docs/nos/postgres.database.md` (substitui `postgres.query.md` e `postgres.write.md`), `workflow-json.md`, `importacao-n8n.md`, `contratos.md`, `README.md` |

## Design

### §1 Parâmetros de `postgres.database`

| Parâmetro | Operações | Observação |
|---|---|---|
| `operation` | todas | `executeQuery`, `select`, `insert`, `update`, `upsert`, `deleteTable` (padrão `insert`, como no N8N) |
| `query`, `queryParameters`, `mode`, `queryOptions` (`maxRows`, `statementTimeoutMs`) | `executeQuery` | Os do `postgres.query` |
| `schema`, `table` | todas, menos `executeQuery` | Com `x-load-options` |
| `columns`, `matchingColumns`, `writeOptions` (`transaction`, `batchSize`, `returning`, `skipOnConflict`, `statementTimeoutMs`) | `insert`, `update`, `upsert` | Os do `postgres.write` |
| `returnAll`, `limit` (padrão 50), `sort[]` (`column`, `direction`) | `select` | Como no N8N |
| `where[]` (`column`, `condition`, `value`), `combineConditions` (`AND`/`OR`) | `select`; `deleteTable` com `deleteCommand = delete` | |
| `deleteCommand` (`delete` padrão, `truncate`, `drop`), `deleteOptions` (`cascade`, `restartSequences`) | `deleteTable` | O padrão do N8N é `truncate`; aqui é `delete` (mais seguro). A importação grava o comando explicitamente |

Opções separadas por operação (`queryOptions`, `writeOptions`, `deleteOptions`), porque o `x-display-options` só enxerga campos irmãos. Os executores atuais leem `options`; o nó lhes entrega um contexto com o apelido (`options` → `queryOptions` ou `writeOptions`).

### §2 Condições e seleção (`conditions.ts`, `select.ts`)

- **`whereClause(where, combine, ensureColumn, param)`:** devolve `"col" = $1 AND "col2" IS NULL`… com os operadores do FR-005 (`equal` → `=`, `!=` → `<>`). Valor nulo nos operadores de nulo é ignorado. Sem condições: sem `WHERE`.
- **Select:** por item, numa transação somente leitura se a credencial for:
  - **SQL:** `SELECT * FROM "s"."t" [WHERE …] [ORDER BY "c" ASC|DESC, …] [LIMIT $n]`;
  - **itens:** cada linha vira um item com `pairedItem` do item de entrada;
  - **falha:** o item que falha segue o modo de erro do nó, como na gravação.

### §3 Exclusão (`delete.ts`)

- **`delete`:** por item, `DELETE FROM "s"."t" [WHERE …] RETURNING *`; as linhas excluídas viram itens.
- **`truncate`:** `TRUNCATE "s"."t" [RESTART IDENTITY] [CASCADE]`, uma vez.
- **`drop`:** `DROP TABLE "s"."t" [CASCADE]`, uma vez, e descarta as colunas da tabela no `ColumnCache`.
- **Saída:**
  - **`delete`:** as linhas excluídas;
  - **`truncate` e `drop`:** um item `{ success: true, command }` por item de entrada, como no N8N, com `command` sem valores.

  A transação respeita a credencial somente leitura (FR-007).

### §4 Migração (`legacy-postgres.ts`)

| Antes | Depois |
|---|---|
| `postgres.query` `{ query, queryParameters, mode, options }` | `postgres.database` `{ operation: 'executeQuery', query, queryParameters, mode, queryOptions: options }` |
| `postgres.write` `{ operation, schema, table, columns, matchingColumns, options }` | `postgres.database` `{ operation, schema, table, columns, matchingColumns, writeOptions: options }` |

`id`, `name`, credencial, `settings`, `disabled`, arestas e dados fixados ficam iguais. A função é pura e idempotente.

### §5 Importação do N8N

O conversor do `n8n-nodes-base.postgres` 2.x passa a gerar `postgres.database`:
- **`executeQuery`, `insert`, `update`, `upsert`:** os mesmos mapeamentos de hoje, com as opções em `queryOptions` e `writeOptions`;
- **`select`:** `returnAll`, `limit`, `where.values[]`, `combineConditions` e `sort.values[]`;
- **`deleteTable`:** `deleteCommand` (padrão `truncate` do N8N, gravado explicitamente), `where.values[]`, `combineConditions` e `options.cascade`/`restartSequences`;
- **pendências:** `outputColumns`, `largeNumbersOutput`, `replaceEmptyStrings` e `queryBatching: independently`.

O v1 continua: `executeQuery` convertido, o resto como marcador.

## Modelo de dados

Sem mudança.

## Contratos

| Contrato | Mudança |
|---|---|
| Tipos de nó | `postgres.database` substitui `postgres.query` e `postgres.write` (migrados na leitura) |
| Saída de `truncate`/`drop` | `{ success: true, command }` |

## Permissões RBAC

Nenhuma rota nem permissão nova.

## Configuração

Nenhuma.

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Opções por operação (`queryOptions`, `writeOptions`, `deleteOptions`) | Um `options` com tudo | `x-display-options` só referencia campos irmãos: um `options` único mostraria as opções de todas as operações |
| `deleteCommand` padrão `delete` | `truncate`, como o N8N | Um nó novo não esvazia a tabela por engano; a importação mantém o comando do N8N |
| `truncate`/`drop` uma vez por execução | Uma vez por item (N8N) | No N8N, o `DROP` falha do segundo item em diante |
| Migração na leitura | Script que reescreve o banco | Mesmo mecanismo da spec 018, sem reescrever versões publicadas |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001, FR-002 | Integração | `postgres/database/postgres-database.int.test.ts` (executar consulta e gravar pelo nó único) e os testes atuais dos executores |
| FR-003, FR-005, FR-006 | Unidade + integração | `conditions.test.ts`; `postgres-database.int.test.ts` (seleção) |
| FR-004, FR-007 | Integração | `postgres-database.int.test.ts` (excluir, esvaziar, remover; somente leitura) |
| FR-008 | Unidade + integração | `legacy-postgres.test.ts`; API (workflow gravado com os tipos antigos) |
| FR-009 | Unidade | `n8n.test.ts` |
| FR-010 | Unidade | testes atuais da ferramenta `tool.postgresQuery` |
| FR-011 | Unidade | `docs.test.ts` |

## Riscos

| Risco | Mitigação |
|---|---|
| `DROP`/`TRUNCATE` por engano | Padrão `delete`; comandos destrutivos explícitos no painel e registrados na saída; credencial somente leitura bloqueia |
| Testes e documentos com os tipos antigos | Passam pela migração; os documentos antigos apontam para o novo |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 14/10/2026 | Criação do plano | Spec 022 |
