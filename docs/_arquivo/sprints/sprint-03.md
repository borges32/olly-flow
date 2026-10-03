# Sprint 3 — Credenciais, HTTP Request e PostgreSQL

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Leia também os relatórios em `docs/relatorios/` e as seções 6.4, 6.5, 6.6 e 9 de `docs/analise_implementacao.md`.

## Pré-requisitos

- Sprint 2 concluída e todos os comandos da seção 8 passando.

## Contexto

Os workflows precisam integrar APIs externas e bancos PostgreSQL da instituição. Credenciais são dados sensíveis: ficam criptografadas, nunca voltam para a UI e nunca aparecem em logs. As chamadas HTTP de saída são um vetor de SSRF e precisam de filtro.

## Objetivo

Cofre de credenciais criptografado, nós `http.request`, `postgres.query` e `postgres.write`, e as configurações de resiliência por nó (retry, timeout, *on error*).

## Tarefas

### T1 — Criptografia de credenciais (`packages/db/crypto` ou `apps/api/credentials`)
- *Envelope encryption* com **AES-256-GCM**: cada credencial tem uma DEK aleatória cifrada pela chave mestra (KEK).
- Interface `KeyProvider` com `encrypt(dek)`, `decrypt(blob)` e `currentKeyVersion()`. Implemente apenas `EnvKeyProvider`, que lê `OLLY_MASTER_KEY` (base64, 32 bytes; a API não sobe sem ela). Vault/KMS chegam na Sprint 8 (ADR-007).
- Migration `credentials`, conforme a seção 10 da análise (`data_encrypted`, `key_version`).

### T2 — API de credenciais
- CRUD em `/api/v1/projects/:id/credentials` (`credential:manage`) e listagem para uso em nós (`credential:use`).
- **Respostas nunca incluem segredos:** apenas `id`, `name`, `type`, metadados não sensíveis e `updatedAt`. Na edição, campos secretos em branco mantêm o valor atual.
- `POST /credentials/:id/test` testa a conexão (HTTP: request configurável; Postgres: `SELECT 1`).
- Toda criação, alteração, exclusão ou teste gera registro em `audit_log`, sem os valores.
- O engine obtém a credencial descriptografada **somente** no momento da execução, via `ctx.getCredential()`. O objeto descriptografado nunca é serializado no log de execução.

### T3 — Tipos de credencial
- Defina os tipos com JSON Schema (o mesmo mecanismo de formulário dos nós), marcando campos secretos com `"x-secret": true`:
  - `httpBearer`: `token`;
  - `httpBasic`: `user`, `password`;
  - `httpHeaderAuth`: `name`, `value`;
  - `httpQueryAuth`: `name`, `value`;
  - `oauth2ClientCredentials`: `tokenUrl`, `clientId`, `clientSecret`, `scope`. O token obtido fica em cache até expirar;
  - `postgres`: `host`, `port`, `database`, `user`, `password`, `ssl` (`disable` | `require` | `verify-full`), `caCert?`, `readOnly: boolean`.

### T4 — Filtro anti-SSRF (`packages/nodes/src/shared/http-guard.ts`)
- Resolva o DNS **antes** de conectar e valide **todos** os IPs resolvidos (proteção contra *DNS rebinding*: conecte no IP validado).
- Bloqueie por padrão:
  - loopback, faixas privadas (RFC 1918) e link-local (incluindo `169.254.169.254`);
  - CGNAT, IPv6 ULA e link-local;
  - `0.0.0.0`.
- A allowlist de hosts/CIDRs internos é configurada por variável de ambiente nesta sprint (`OLLY_HTTP_ALLOWLIST`). A tela de administração fica para depois.
- Valide também cada destino de **redirect**.
- Esse guard será reutilizado pelo cliente MCP (Sprint 9).

### T5 — Nó `http.request`
- **Parâmetros:**
  - `method`, `url`, `authentication` (`none` ou credencial), `queryParameters[]` e `headers[]`;
  - `body` com `contentType`: `json` | `form-urlencoded` | `multipart` | `raw` | `binary`;
  - `options`: `timeout` (padrão 30 s), `followRedirects`, `maxRedirects`, `fullResponse` (status, headers e body), `responseFormat` (`auto` | `json` | `text` | `binary`), `neverError` (não lançar erro em status ≥ 400) e `batching` (`batchSize`, `batchIntervalMs`).
- Executa **uma requisição por item**, com parâmetros resolvidos por item.
- Use `undici` com o guard da T4.
- Limite o tamanho da resposta (padrão 50 MB). Respostas binárias vão para o MinIO como `BinaryRef`.
- Paginação: **fora** do escopo (Sprint 7).

### T6 — Nó `postgres.query`
- Parâmetros: `query` (SQL), `queryParameters` (array de expressões, mapeadas para `$1..$n`), `mode` (`once` = uma execução para todos os itens | `perItem`), `options.maxRows` (padrão 1000) e `options.statementTimeoutMs` (padrão 30 000).
- **Nunca interpole** valores de expressão no texto SQL: expressões em `query` são **proibidas** (retorne erro de validação). Valores entram somente via `queryParameters`.
- Pool de conexões `pg.Pool` por credencial, com tamanho máximo configurável e cache por `credentialId + updatedAt`.
- Se a credencial tiver `readOnly: true`, rode a query em `BEGIN READ ONLY` … `COMMIT`.
- A saída é um item por linha (`{ json: row }`), com `pairedItem` correto.

### T7 — Nó `postgres.write`
- `operation`: `insert` | `update` | `upsert`. `schema` e `table` são selecionáveis na UI.
- `columns.mappingMode`: `autoMap` (campos do item com o mesmo nome das colunas) | `defineBelow` (lista coluna → expressão).
- `update`/`upsert`: `matchingColumns[]`.
- `options`:
  - `transaction`: `none` | `allItems` (uma transação; rollback de tudo se algum item falhar);
  - `batchSize` (insert multi-linha);
  - `returning` (`*` por padrão);
  - `skipOnConflict` (somente insert).
- Identificadores (schema, tabela, colunas) validados contra o catálogo do banco e escapados com `pg-format`/`escapeIdentifier`. Valores sempre parametrizados.
- Endpoints de apoio (`credential:use`): `GET /credentials/:id/postgres/tables` e `GET /credentials/:id/postgres/tables/:schema.:table/columns`.

### T8 — Configurações de resiliência por nó (engine)
- `settings.retry`: tentativas, espera e backoff (`fixed` | `exponential`). Registre cada tentativa em `node_executions.attempts`.
- `settings.timeoutMs`: cancela o nó com `AbortSignal` propagado para HTTP e Postgres (`pg` cancela via `pg_cancel_backend`).
- `settings.onError`:
  - `stop` (padrão): a execução termina com `error`;
  - `continue`: o item com erro segue para a saída `main` como `{ json: { error: { message, ... } } }`;
  - `errorOutput`: fica para a Sprint 6. Por enquanto, o editor não deve oferecer essa opção.
- Aba **"Configurações"** no painel do nó para editar esses campos.

### T9 — Frontend
- Tela `/credentials`: lista, criação/edição por tipo (formulário gerado pelo schema, campos secretos mascarados) e botão "Testar".
- Seletor de credencial no painel do nó, filtrado pelos tipos aceitos (`credentialTypes`), com atalho "Criar nova".
- `postgres.write`: dropdowns de schema, tabela e colunas carregados da API; mapeamento coluna → expressão.

### T10 — Ambiente de testes
- Testcontainers com um PostgreSQL "externo" (diferente do banco da plataforma) para os testes dos nós Postgres.
- Servidor HTTP de teste local (permitido via allowlist nos testes) para os testes do nó HTTP.

## Fora do escopo

Webhook, código JS, fila, Vault/KMS, paginação HTTP, OAuth2 Authorization Code e porta de erro (`errorOutput`).

## Critérios de aceite

| # | Critério | Verificação |
|---|---|---|
| 1 | Workflow `Manual → HTTP Request (API de teste) → Postgres Insert → Postgres Query` funciona pelo editor | E2E `integrations.spec.ts` |
| 2 | Resposta de qualquer endpoint de credenciais não contém senha/token (varredura automática nos testes) | Integração |
| 3 | Credenciais não aparecem em `node_executions`, logs pino ou mensagens de erro | Integração (busca pelo valor secreto) |
| 4 | Requisições a `127.0.0.1`, `10.0.0.1`, `169.254.169.254`, `[::1]` e a um domínio que resolve para IP privado são bloqueadas; o redirect para IP privado também | Unitário `http-guard.test.ts` |
| 5 | Valor `'; DROP TABLE x; --` em `queryParameters` é tratado como dado | Integração |
| 6 | Expressão no campo `query` é rejeitada na validação | Unitário |
| 7 | `transaction: allItems` faz rollback de todos os itens se um falhar | Integração |
| 8 | Retry com backoff exponencial executa o número correto de tentativas; timeout cancela a query Postgres | Integração |
| 9 | `onError: continue` gera item de erro e a execução segue | Unitário no engine |
| 10 | Credencial `readOnly` impede `INSERT` via `postgres.query` | Integração |

## Entrega

Código, `docs/nos/http.request.md`, `docs/nos/postgres.query.md`, `docs/nos/postgres.write.md`, `docs/credenciais.md` e o relatório `docs/relatorios/sprint-03.md`.
