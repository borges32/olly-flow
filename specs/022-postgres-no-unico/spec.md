# Spec 022 — Nó PostgreSQL único, com excluir e selecionar, como no N8N

| Campo                     | Valor                                                |
| ------------------------- | ---------------------------------------------------- |
| **Status**                | Implementada                                         |
| **Fase**                  | 4 — Hardening (paridade com o N8N, apoio à migração) |
| **Depende de**            | 004, 015, 018                                        |
| **Requisitos de produto** | PR-04 (parcial), PR-05 (parcial), PR-17 (parcial)    |
| **ADRs relacionadas**     | 0001                                                 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Hoje o PostgreSQL tem dois nós (spec 004):

- **PostgreSQL: consulta** (`postgres.query`): SQL parametrizado;
- **PostgreSQL: gravar** (`postgres.write`): inserir, atualizar e upsert.

O N8N tem um nó **Postgres** único, com as operações:

- **Execute Query:** SQL;
- **Select:** linhas por condições;
- **Insert**, **Update** e **Upsert**;
- **Delete:** apagar linhas por condições, esvaziar a tabela (`TRUNCATE`) ou removê-la (`DROP TABLE`).

O Olly Flow não tem como excluir registros. Na importação, as operações **Delete** e **Select** do N8N viram nós marcadores (spec 015), e quem migra precisa reescrevê-las em SQL. O PO pediu (14/10/2026) as operações de exclusão e atualização, com a importação do N8N compatível. Também decidiu:

- **exclusão igual à do N8N:** `DELETE` com condições, `TRUNCATE` e `DROP TABLE`;
- **nó único "PostgreSQL",** como no N8N, migrando os workflows salvos com os nós atuais;
- **importação do Select do N8N.**

## Histórias de usuário

### HU-1 — Um nó PostgreSQL com todas as operações (Prioridade: P1)

Como **editor**, quero um único nó PostgreSQL em que escolho a operação, como no N8N, para não precisar saber qual nó usar.

**Teste independente:** adicionar o nó, trocar a operação e conferir que o painel mostra só os campos da operação escolhida.

**Cenários de aceite:**

1. **Dado** o nó PostgreSQL, **quando** escolho a operação, **então** posso escolher entre executar consulta, selecionar, inserir, atualizar, upsert e excluir, com os nomes de operação do N8N.
2. **Dado** uma operação escolhida, **quando** vejo o painel, **então** aparecem só os campos dela (SQL e parâmetros na consulta; tabela, colunas e condições nas demais).
3. **Dado** executar consulta, inserir, atualizar ou upsert, **quando** executo, **então** o resultado é o mesmo dos nós atuais (spec 004): parâmetros posicionais, mapeamento de colunas, colunas de correspondência, lote, transação e retorno.

### HU-2 — Excluir registros (Prioridade: P1)

Como **editor**, quero excluir registros de uma tabela por condições e, quando preciso, esvaziar ou remover a tabela, como no N8N.

**Teste independente:** com uma tabela de teste, excluir linhas por uma condição com expressão, esvaziar a tabela e removê-la, conferindo o banco e a saída.

**Cenários de aceite:**

1. **Dado** o comando "Excluir linhas" com condições (coluna, operador, valor com expressão), **quando** executo, **então** só as linhas que atendem são apagadas, uma vez por item, e a saída traz as linhas excluídas.
2. **Dado** várias condições, **quando** escolho combiná-las com E ou com OU, **então** a exclusão usa a combinação escolhida.
3. **Dado** "Excluir linhas" sem condições, **quando** executo, **então** todas as linhas são apagadas, como no N8N.
4. **Dado** o comando "Esvaziar a tabela" (`TRUNCATE`), **quando** executo, **então** a tabela fica vazia, com as opções "reiniciar sequências" e "em cascata". A saída informa o comando executado.
5. **Dado** o comando "Remover a tabela" (`DROP TABLE`), **quando** executo, **então** a tabela deixa de existir, com a opção "em cascata". A saída informa o comando executado.
6. **Dado** uma credencial em modo somente leitura (spec 004), **quando** tento excluir, **então** o banco recusa, e o nó falha com a mensagem do PostgreSQL.

### HU-3 — Selecionar registros sem escrever SQL (Prioridade: P2)

Como **editor**, quero buscar linhas por condições, ordenação e limite, como no Select do N8N, para consultar sem escrever SQL.

**Teste independente:** selecionar linhas por condição, ordenar e limitar, conferindo a saída.

**Cenários de aceite:**

1. **Dado** condições, ordenação e limite (ou "todas as linhas"), **quando** executo, **então** cada linha que atende vira um item, na ordem pedida, uma consulta por item de entrada.
2. **Dado** os operadores igual, diferente, contém (`LIKE`), maior, menor, maior ou igual, menor ou igual, é nulo e não é nulo, **quando** uso cada um, **então** o resultado corresponde a ele.

### HU-4 — Workflows existentes continuam iguais (Prioridade: P1)

Como **editor**, quero que os workflows salvos com os nós atuais passem para o nó único sozinhos, sem mudar o resultado.

**Teste independente:** abrir e executar um workflow gravado com `postgres.query` e `postgres.write` e conferir o nó único e o mesmo resultado.

**Cenários de aceite:**

1. **Dado** um workflow salvo com os nós atuais (rascunho, versões ou arquivo exportado), **quando** é lido, salvo, executado ou importado, **então** os nós aparecem como o nó PostgreSQL com a operação correspondente e as mesmas configurações.
2. **Dado** uma versão publicada antiga, **quando** executa, **então** o resultado é o mesmo, sem reescrever o histórico.

### HU-5 — Importar o Postgres do N8N (Prioridade: P1)

Como **editor que migra do N8N**, quero que o nó Postgres seja importado em todas as operações, para não reescrever os workflows.

**Teste independente:** importar workflows do N8N com cada operação do Postgres (2.x) e conferir o nó convertido, sem marcadores.

**Cenários de aceite:**

1. **Dado** um Postgres do N8N (2.x) com Execute Query, Select, Insert, Update, Upsert ou Delete, **quando** importo, **então** ele vira o nó PostgreSQL com a mesma operação e as mesmas configurações.
2. **Dado** opções sem equivalente (ex.: colunas de saída, tratamento de números grandes), **quando** importo, **então** o relatório da importação mostra a pendência.
3. **Dado** o Postgres do N8N v1, **quando** importo, **então** a consulta (Execute Query) é convertida e as demais operações continuam como marcadores, como hoje (fora do escopo, decisão do PO).

### Casos de borda

- **Coluna inexistente** nas condições ou na ordenação: o nó falha antes de executar, citando a coluna (os nomes são conferidos no catálogo do banco, como na gravação da spec 004).
- **"É nulo" e "não é nulo":** o valor é ignorado.
- **"Esvaziar" e "remover" com vários itens de entrada:** o comando roda uma vez por execução do nó (no N8N, rodaria uma vez por item, e o `DROP` falharia a partir do segundo).
- **"Continuar" em caso de erro** (spec 004): na exclusão e na seleção, o item que falha vira item de erro, como na gravação.
- **Tabela removida:** o cache das colunas dessa tabela é descartado.

## Requisitos funcionais

- **FR-001**: O sistema DEVE oferecer o nó **PostgreSQL** com as operações `executeQuery`, `select`, `insert`, `update`, `upsert` e `deleteTable` (nomes do N8N), mostrando no painel só os campos da operação escolhida. Os nós "PostgreSQL: consulta" e "PostgreSQL: gravar" deixam a paleta.
- **FR-002**: As operações `executeQuery`, `insert`, `update` e `upsert` DEVEM manter o comportamento da spec 004 (FR-011 a FR-015).
- **FR-003**: A operação `select` DEVE buscar linhas da tabela por condições, combinadas com E ou OU, com ordenação e limite (ou todas as linhas), uma consulta por item de entrada. Cada linha vira um item.
- **FR-004**: A operação `deleteTable` DEVE oferecer os comandos:
  - **`delete`:** exclui as linhas pelas condições (todas, sem condições), uma vez por item, e devolve as linhas excluídas;
  - **`truncate`:** esvazia a tabela, com "reiniciar sequências" e "em cascata";
  - **`drop`:** remove a tabela, com "em cascata".

  O `truncate` e o `drop` rodam uma vez por execução do nó e devolvem `{ success, command }`, que fica no log da execução.

- **FR-005**: As condições DEVEM aceitar os operadores `equal`, `!=`, `LIKE`, `>`, `<`, `>=`, `<=`, `IS NULL` e `IS NOT NULL`, com valor por expressão (exceto os de nulo).
- **FR-006**: Tabelas, colunas das condições e da ordenação DEVEM existir no catálogo do banco, e os valores DEVEM ir só como parâmetros, nunca concatenados ao SQL.
- **FR-007**: Com a credencial em modo somente leitura, as operações que escrevem DEVEM ser recusadas pelo banco, como na spec 004.
- **FR-008**: Os workflows com `postgres.query` e `postgres.write` DEVEM ser migrados para o nó único na leitura, no salvamento, na execução e na importação de arquivos do Olly Flow, sem reescrever as versões publicadas e com o mesmo resultado.
- **FR-009**: O importador do N8N DEVE converter o Postgres 2.x em todas as operações (Execute Query, Select, Insert, Update, Upsert e Delete), com as opções sem equivalente como pendências. O Postgres v1 continua só com o Execute Query.
- **FR-010**: A ferramenta do Agent "Consulta PostgreSQL" (`tool.postgresQuery`, spec 011) DEVE continuar igual.
- **FR-011** (19/10/2026): O item de entrada que não devolver nenhuma linha DEVE gerar `{ success: true }`, vinculado a ele, como no N8N, para o fluxo seguir: por item no `select` e no `delete`; nas gravações (que podem rodar em lote), quando nenhuma linha voltar; o `executeQuery` mantém a regra da spec 004 (por item, ou uma vez no modo "uma vez"). Itens que foram para a saída de erro não geram o item de sucesso.
- **FR-011**: A documentação do nó DEVE existir em `docs/nos/`, e o catálogo de `docs/nos/workflow-json.md` DEVE descrever o nó, para pessoas e modelos de IA (spec 015).

## Requisitos não funcionais

- **NFR-001**: A seleção e a exclusão usam o mesmo pool, timeout de comando, cancelamento e transação da spec 004.
- **NFR-002**: Os testes de integração usam um PostgreSQL real (Testcontainers).

## Entidades-chave

- **Condição:** coluna, operador e valor.
- **Comando de exclusão:** excluir linhas, esvaziar ou remover a tabela, com as opções.

## Critérios de sucesso

- **SC-001**: Num banco de teste, excluir por condição apaga só as linhas certas e devolve-as; esvaziar e remover deixam a tabela vazia ou inexistente.
- **SC-002**: Selecionar com condições, ordenação e limite devolve as linhas esperadas, na ordem.
- **SC-003**: Um workflow gravado com os nós atuais é lido como o nó único e executa com o mesmo resultado.
- **SC-004**: Workflows do N8N com cada operação do Postgres 2.x importam sem marcadores.

## Fora do escopo

- Postgres v1 do N8N além do Execute Query (decisão do PO, 14/10/2026).
- Opções do N8N sem equivalente: colunas de saída, números grandes, substituir strings vazias, `queryBatching` "independently" (vira o padrão).

## Pré-requisitos humanos

- Nenhum. Pontos decididos pelo PO em 14/10/2026.

## Pontos em aberto

Nenhum.

## Histórico de alterações

| Data       | Alteração                                                                                                                                                                                                                                                                                                                                                                                                             | Motivo                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 14/10/2026 | Criação da spec, a pedido do PO (operações de exclusão e atualização no PostgreSQL, compatíveis com a importação do N8N). Decisões do PO: exclusão igual à do N8N (`DELETE`, `TRUNCATE`, `DROP`); nó único "PostgreSQL" com migração dos workflows salvos; importação do Select; Postgres v1 fora. O "atualizar" já existia no "PostgreSQL: gravar" e passa para o nó único. Implementação pedida diretamente pelo PO | Paridade com o N8N                                                            |
| 14/10/2026 | Implementação concluída ([relatório](report.md))                                                                                                                                                                                                                                                                                                                                                                      | —                                                                             |
| 19/10/2026 | FR-011: item sem linhas no resultado gera `{ success: true }` (antes, só o `executeQuery` fazia isso; `select`, `delete` e as gravações sem correspondência terminavam com 0 itens e o fluxo parava). Teste: `postgres-database.int.test.ts` › "FR-004 (correção 19/10/2026)…"                                                                                                                                        | Erro relatado pelo PO: o "Deleta memoria" não passava nada para o nó seguinte |
