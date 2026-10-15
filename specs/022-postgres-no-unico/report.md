# Relatório — Spec 022: Nó PostgreSQL único, com excluir e selecionar

**Status:** Implementada
**Data:** 14/10/2026

## Resumo

O nó **PostgreSQL** (`postgres.database`) tem as operações do Postgres do N8N:
- **`executeQuery`:** consulta SQL;
- **`select`:** linhas por condições, ordenação e limite;
- **`insert`**, **`update`** e **`upsert`:** gravação;
- **`deleteTable`:** excluir linhas por condições, esvaziar a tabela (`TRUNCATE`) ou removê-la (`DROP TABLE`), igual ao N8N.

Ele substitui os nós "PostgreSQL: consulta" e "PostgreSQL: gravar" da spec 004, que são migrados sozinhos na leitura, no salvamento, na execução e na importação de arquivos, com o mesmo resultado. O "atualizar" já existia no "gravar" e continua igual no nó único. A importação do N8N converte todas as operações do Postgres 2.x, inclusive o Select e o Delete, que antes viravam marcadores.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `packages/shared-types/src/legacy-postgres.ts` (`migrateLegacyPostgres`, `migrateLegacyPostgresNode`, `POSTGRES_NODE_TYPE`), dentro de `migrateLegacyDefinition` |
| T002 | ✅ | `packages/nodes/src/postgres/database/conditions.ts` (`whereClause`, `orderByClause`) |
| T010 | ✅ | `packages/nodes/src/postgres/database/definition.ts`; `builtin.ts` registra o nó único no lugar dos dois |
| T011 | ✅ | `packages/nodes/src/postgres/database/operations.ts` (`executeSelect`, `executeDelete`); `ColumnCache.invalidate` |
| T012 | ✅ | `postgres-database.int.test.ts` (7 casos, PostgreSQL real) |
| T020 | ✅ | `apps/api/src/workflows/legacy-postgres.int.test.ts`; testes do motor atualizados para o nó único; os testes da API com os tipos antigos (cancelamento, vazamento de credenciais, carga) seguem pela migração na entrada da API; `fromWorkflowFile` migra antes de conferir o catálogo |
| T021 | ✅ | `apps/api/src/workflow-io/n8n/converters.ts` (`convertPostgres`) e testes em `n8n.test.ts` |
| T022 | ✅ | Ícone já existente (`database`); cenário novo em `apps/web/e2e/integrations.spec.ts` |
| T030 | ✅ | `docs/nos/postgres.database.md` (novo); `postgres.query.md` e `postgres.write.md` apontam para ele; `workflow-json.md`, `README.md`, `importacao-n8n.md`, `contratos.md`, `execucao.md` |
| T090–T093 | ✅ | Ver abaixo |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `postgres-database.int.test.ts` › "FR-001/FR-002…"; E2E `integrations.spec.ts` › "spec 022 — FR-001/FR-003/FR-004…" (campos por operação); `registry.test.ts` (schema válido no catálogo); `workflows.int.test.ts` (catálogo com `postgres.database`) |
| FR-002 | Sim | `postgres-database.int.test.ts` › "FR-001/FR-002…" (consulta com `queryOptions`, gravação com `writeOptions`); os testes da spec 004 dos executores continuam passando |
| FR-003 | Sim | `postgres-database.int.test.ts` › "SC-002/FR-003/FR-005…", "FR-003: uma consulta por item…"; `conditions.test.ts` › "FR-003…" |
| FR-004 | Sim | `postgres-database.int.test.ts` › "SC-001/FR-004: excluir linhas…", "SC-001/FR-004: esvaziar… remover…"; E2E (exclusão pelo editor) |
| FR-005 | Sim | `conditions.test.ts` › "FR-005/FR-006…", "FR-005: OR combina…" |
| FR-006 | Sim | `conditions.test.ts` (colunas entre aspas, valores como parâmetros, injeção no valor fica no parâmetro); `postgres-database.int.test.ts` › "FR-006: coluna inexistente…" |
| FR-007 | Sim | `postgres-database.int.test.ts` › "FR-007: com a credencial somente leitura…" |
| FR-008 | Sim | `legacy-postgres.test.ts` (2 casos); `workflow-file.test.ts` › "spec 022 — FR-008…" (arquivo antigo sem marcador); `legacy-postgres.int.test.ts` › "FR-008/SC-003…" (versão gravada no formato antigo: leitura, execução e publicação) |
| FR-009 | Sim | `n8n.test.ts` › "SC-004/FR-009: Select, Delete… e Update…", "FR-009: o Postgres v1…" e o teste da spec 015 atualizado (consulta e upsert) |
| FR-010 | Sim | `apps/api/src/ai/agent.int.test.ts` › "SC-001: webhook → Agent usa as ferramentas Postgres…" e "FR-008: a ferramenta Postgres não aceita SQL vindo do modelo…" (sem mudança) |
| FR-011 | Sim | `apps/api/src/workflow-io/docs.test.ts` (tipo documentado; exemplos importáveis) |
| NFR-001 | Sim | Seleção e exclusão usam `inTransaction` (pool, timeout, cancelamento, somente leitura) |
| NFR-002 | Sim | `postgres-database.int.test.ts` e `legacy-postgres.int.test.ts` com PostgreSQL real |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `postgres-database.int.test.ts` › "SC-001…" (dois casos) |
| SC-002 | ✅ | `postgres-database.int.test.ts` › "SC-002…" |
| SC-003 | ✅ | `legacy-postgres.int.test.ts` › "FR-008/SC-003…" |
| SC-004 | ✅ | `n8n.test.ts` › "SC-004/FR-009…" (cinco nós, nenhum marcador) |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 872 testes (815 nos pacotes, com `turbo run test --continue`, e 57 na raiz). Em duas rodadas do `pnpm test`, falhou só o teste de tempo das expressões (spec 003, "NFR-002: 1000 itens × 3 expressões em menos de 1 s"), com a máquina carregada (média de carga 5 a 7), o que interrompeu os demais pacotes. Na rodada completa e isolado (2 de 2), passou. O pacote de expressões não foi alterado |
| `pnpm build` | ✅ |
| `pnpm test:integration` | ✅ 394 testes (api 332, nodes 30, db 29, engine 3) |
| `pnpm test:e2e` | ✅ 52 de 52, inclusive o cenário novo do PostgreSQL. Na primeira rodada, o cenário novo falhou no preparo da tabela: o SQL de criação e de inserção ia num comando só, e a consulta parametrizada (com cursor) aceita um por vez. Corrigido no teste |
| `pnpm app:up && pnpm smoke` | ✅ |

## Decisões tomadas

- **Decisões do PO (14/10/2026):**
  - exclusão igual à do N8N (`DELETE` com condições, `TRUNCATE` e `DROP`);
  - nó único "PostgreSQL" com migração dos workflows salvos;
  - importação do Select;
  - Postgres v1 fora (só o Execute Query, como antes).
- **Opções por operação** (`queryOptions`, `writeOptions`, `deleteOptions`): o `x-display-options` só enxerga campos irmãos, então um `options` único mostraria as opções de todas as operações. Os executores da spec 004 continuam lendo `options`; o nó único entrega a eles um contexto com o apelido.
- **`deleteCommand` padrão `delete`:** um nó novo não esvazia nem remove a tabela por engano. O padrão do N8N é `truncate`, e a importação grava o comando do N8N explicitamente.
- **`truncate` e `drop` uma vez por execução do nó:** no N8N, rodariam por item, e o `DROP` falharia do segundo em diante. A saída traz `{ success, command }`, gravada no log da execução.
- **Exclusão sem condições apaga todas as linhas,** como no N8N; a documentação destaca isso.
- **Migração antes do catálogo na importação de arquivos:** sem isso, um arquivo antigo do Olly Flow com `postgres.query` viraria marcador, porque o tipo não está mais no catálogo.
- **Ferramenta do Agent:** `tool.postgresQuery` continua igual. O `createPostgresQueryNode` segue como a base dela, fora da paleta.

## Desvios da spec/plano

Nenhum.

## Dependências adicionadas

Nenhuma.

## Pendências, bloqueios e riscos

- **Comandos destrutivos:** `TRUNCATE` e `DROP` estão disponíveis, como no N8N (decisão do PO). A proteção é a credencial em modo somente leitura, onde for o caso.
- **Fixtures reais:** workflows da POC com o Postgres em `fixtures/n8n/`, quando houver.

## Como demonstrar

1. `pnpm app:up` e entre no editor.
2. Adicione o nó **PostgreSQL**, escolha uma credencial e troque a **Operação**: o painel mostra só os campos de cada uma.
3. Em **deleteTable** com o comando `delete`, informe uma condição (ex.: `nome` `equal` `Bruno`) e execute: a saída traz as linhas excluídas.
4. Em **select**, ordene e limite: cada linha vira um item.
5. Abra um workflow criado antes desta spec, com "PostgreSQL: consulta" ou "PostgreSQL: gravar": ele aparece com o nó único e executa igual.
6. Importe do N8N um workflow com o Postgres em Select e Delete: nenhum marcador.
