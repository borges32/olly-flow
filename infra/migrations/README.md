# Migrations

Executadas pelo migrator Kysely de [`packages/db`](../../packages/db/src/migrator.ts), em ordem de nome.

- Cada migration é um par de arquivos SQL: `NNNN_nome.up.sql` e `NNNN_nome.down.sql`. O `down` é obrigatório (FR-009 da spec 001): o migrator recusa uma migration sem ele.
- Cada migration roda em uma transação (DDL transacional do PostgreSQL).
- Nunca altere uma migration já aplicada em algum ambiente; crie uma nova.
  - **Exceção (15/10/2026):** a 0009 e a 0010 usavam `UNIQUE NULLS NOT DISTINCT`, do PostgreSQL 15, e não executavam na 14.18 (produção). Elas passaram a criar índices únicos parciais com o mesmo efeito, e a 0017 faz a mesma troca nos bancos que já tinham aplicado a versão antiga.
- **Compatibilidade:** as migrations precisam rodar no PostgreSQL 14.18 ou superior (versão mínima; [stack](../../docs/arquitetura/stack.md)). Os testes de integração usam a 14.18 por padrão.

| Comando | Efeito |
|---|---|
| `pnpm db:migrate` | Aplica as pendentes |
| `pnpm db:rollback` | Reverte a última (`-- --all` reverte todas) |
| `pnpm db:seed` | Cria/atualiza os papéis padrão |

Ao criar ou alterar tabelas, atualize [`docs/arquitetura/modelo-dados.md`](../../docs/arquitetura/modelo-dados.md) e os tipos em `packages/db/src/schema.ts`.
