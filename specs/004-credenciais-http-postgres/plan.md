# Plano técnico — Spec 004: Credenciais, HTTP Request e PostgreSQL

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Credenciais:** *envelope encryption* AES-256-GCM com `KeyProvider` substituível (implementação `env` nesta spec).
- **Guard anti-SSRF:** compartilhado, resolve o DNS e conecta no IP validado.
- **Nós:** `http.request` com undici; `postgres.query`/`postgres.write` com `pg`.
- **Engine:** resiliência por nó com `AbortSignal`.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| III.2 SQL | Parametrização obrigatória; expressão no campo `query` proibida; identificadores validados |
| III.3 Credenciais | Envelope encryption; DTOs sem segredos; descriptografia só em `ctx.getCredential()` |
| III.5 SSRF | `http-guard` em toda saída |
| VI — Institucional | `KeyProvider` abstrato (ADR-0007 pendente) |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/db` | Migration `credentials`; módulo `crypto` |
| `apps/api` | Módulo `credentials` (CRUD, teste, endpoints de catálogo Postgres) |
| `packages/nodes` | `shared/http-guard.ts`, `http.request`, `postgres.query`, `postgres.write`, tipos de credencial |
| `packages/engine` | Retry, timeout, `onError` |
| `apps/web` | Tela de credenciais, seletor no nó, mapeamento de colunas, aba Configurações |

## Design

### §1 Criptografia
- **Ao gravar:** gera uma DEK aleatória de 32 bytes por credencial e cifra os dados com AES-256-GCM (IV de 12 bytes e *auth tag* armazenados junto). A DEK é cifrada pelo `KeyProvider`.
- `data_encrypted` = `{ v, kekVersion, encDek, iv, tag, ciphertext }` serializado em bytea.
- **Interface:** `KeyProvider { wrap(dek), unwrap(blob), currentKeyVersion() }`.
- **`EnvKeyProvider`:** lê `OLLY_MASTER_KEY` (base64, 32 bytes). A API falha na inicialização se a variável estiver ausente ou inválida.

### §2 API de credenciais

| Método | Rota | Permissão |
|---|---|---|
| GET | `/projects/:id/credentials` | `credential:use` |
| POST | `/projects/:id/credentials` | `credential:manage` |
| PUT/DELETE | `/credentials/:id` | `credential:manage` |
| POST | `/credentials/:id/test` | `credential:manage` |
| GET | `/credential-types` | Autenticado |
| GET | `/credentials/:id/postgres/schemas` | `credential:use` |
| GET | `/credentials/:id/postgres/tables?schema=` | `credential:use` |
| GET | `/credentials/:id/postgres/columns?schema=&table=` | `credential:use` |

- **DTO de saída:** `{ id, name, type, projectId, updatedAt, publicFields }`, onde `publicFields` exclui `x-secret`.
- **PUT:** campo secreto ausente ou vazio mantém o valor atual (*merge* após descriptografar).
- O *pino redact* inclui caminhos de credenciais. O `ExecutionRecorder` nunca serializa `ctx.getCredential()`.

### §3 Tipos de credencial

| Tipo | Campos (secretos em **negrito**) |
|---|---|
| `httpBearer` | **token** |
| `httpBasic` | user, **password** |
| `httpHeaderAuth` | name, **value** |
| `httpQueryAuth` | name, **value** |
| `oauth2ClientCredentials` | tokenUrl, clientId, **clientSecret**, scope (token em cache em memória até `expires_in - 30s`) |
| `postgres` | host, port, database, user, **password**, ssl (`disable`/`require`/`verify-full`), caCert, readOnly |

### §4 Guard anti-SSRF (`packages/nodes/src/shared/http-guard.ts`)
- `lookup` customizado do undici (`connect.lookup`): resolve todos os A/AAAA, valida cada um com `ipaddr.js` e conecta no IP validado.
- **Bloqueados:** `loopback`, `private`, `linkLocal`, `carrierGradeNat`, `uniqueLocal`, `unspecified`, `reserved`, `broadcast` e `multicast`.
- **Allowlist:** `OLLY_HTTP_ALLOWLIST` (hosts e CIDRs separados por vírgula).
- **Redirects:** tratados manualmente (`redirect: 'manual'`), revalidando cada `Location` até `maxRedirects`.
- **Exporta:** `guardedFetch(url, init, opts)` e `assertDestinationAllowed(url)`, reutilizados pelo MCP (spec 010).

### §5 Nó `http.request`
- **Parâmetros:**
  - `method`, `url`, `authentication` (`none` | `credential`), `queryParameters[]` e `headers[]`;
  - `sendBody` + `contentType` (`json` | `form-urlencoded` | `multipart` | `raw` | `binary`) + `body`;
  - `options`: `timeout` (30 000), `followRedirects` (true), `maxRedirects` (5), `fullResponse`, `responseFormat` (`auto` | `json` | `text` | `binary`), `neverError` e `batching { batchSize, batchIntervalMs }`.
- **Execução:** uma requisição por item com `getParam(..., i)`. Resposta acima de `OLLY_HTTP_MAX_RESPONSE_MB` (50) é abortada. O formato binário vai para o MinIO (`BinaryRef { id, mimeType, fileName, size }`).
- **Status ≥ 400 sem `neverError`:** lança `NodeExecutionError` com `httpCode` e um trecho do corpo.

### §6 Nó `postgres.query`
- **Parâmetros:** `query`, `queryParameters[]`, `mode` (`once` | `perItem`), `options.maxRows` (1000) e `options.statementTimeoutMs` (30 000).
- **Validação:** `query` iniciada por `=` → erro de validação do nó (também verificado ao salvar o workflow).
- **Pool:** `PoolManager` com chave `credentialId:updatedAt` e `max = OLLY_PG_POOL_MAX` (5); pools ociosos são fechados.
- **Execução:** `SET LOCAL statement_timeout`. Com `readOnly`, usa `BEGIN READ ONLY`. `maxRows` é aplicado via cursor (`pg-cursor`), com aviso no resultado quando há truncamento.
- **Saída:** um item por linha. `pairedItem` = item de origem (`perItem`) ou 0 (`once`).

### §7 Nó `postgres.write`
- **Parâmetros:**
  - `operation` (`insert` | `update` | `upsert`), `schema`, `table`;
  - `columns.mappingMode` (`autoMap` | `defineBelow`) e `columns.values[]`;
  - `matchingColumns[]`;
  - `options`: `transaction` (`none` | `allItems`), `batchSize` (100), `returning` (`*`) e `skipOnConflict`.
- **Validação:** schema, tabela e colunas existem em `information_schema` (cache de 60 s); escape com `escapeIdentifier`.
- **Comandos:**
  - insert multi-linha por lote;
  - update `... WHERE col = $n`;
  - upsert com `ON CONFLICT (matchingColumns) DO UPDATE SET`.
- **Erros:** em `allItems`, uma transação única com rollback total; em `none`, item a item com `onError`.

### §8 Resiliência no engine
- **`retry`:** laço com espera `waitMs` (fixa ou `waitMs * 2^n`); `node_executions.attempts`.
- **`timeoutMs`:** `AbortController` repassado em `ctx.signal`. Postgres cancela com `client.cancel`/`pg_cancel_backend`; undici, via `signal`.
- **`onError`:**
  - `stop`: falha a execução;
  - `continue`: emite em `main` o item `{ json: { error: { message, description, httpCode } } }` e segue.
- Aba "Configurações" no painel do nó. A opção `errorOutput` fica oculta até a spec 007.

### §9 Testes
- Testcontainers: PostgreSQL "externo" para os nós e servidor HTTP local (fastify) liberado via allowlist.

### §10 Decisões de implementação (04/10/2026)
- **Contrato de nó:** `ctx.getCredential()` devolve `{ id, type, data, updatedAt }` (antes, só os dados): o `http.request` aceita vários tipos e o `PoolManager` usa `id:updatedAt`. `NodeHelpers.registerSecret(valor)` registra segredos derivados (ex.: token OAuth2).
- **Mascaramento de segredos (defesa em profundidade, FR-003):** o motor recebe da API um resolvedor de credenciais; os valores `x-secret` da credencial, o `usuário:senha` em base64 do Basic e os segredos registrados viram `***` em tudo que o `ExecutionRecorder` grava ou transmite (entrada, saída, erro). Os dados entre os nós não mudam (constituição VIII.2).
- **Configuração dos nós:** `createBuiltinNodes({ http, postgres })` recebe allowlist, limite de resposta, armazenamento de binários e `PoolManager`; a API monta o registro com a sua configuração. `builtinNodes` continua existindo com os padrões (allowlist vazia).
- **Extensões de `paramsSchema`:** `x-no-expression` (campo que não aceita expressão: o editor não oferece o modo expressão e o salvamento recusa valor iniciado por `=`), `x-multiline` (área de texto) e `x-load-options` (`postgresSchemas` | `postgresTables` | `postgresColumns`: o editor busca as opções nos endpoints de catálogo da credencial do nó).
- **Uso de credencial (FR-007):** ao salvar, um nó que passa a referenciar uma credencial (nó novo ou `credentialId` alterado) exige `credential:use` no projeto, e a credencial precisa existir no mesmo projeto do workflow e ter um tipo aceito pelo nó (422 caso contrário). Na execução de teste sem `credential:use`, um workflow que usa credenciais só roda se a definição enviada for igual à versão salva (nós sem posição, conexões e pin data), para que quem não pode usar a credencial não consiga mudar o destino dos segredos. Na execução, a credencial precisa ser do projeto do workflow.
- **Teste de credencial:** Postgres conecta e roda `SELECT 1`; OAuth2 obtém um token; Bearer, Basic, header e query não têm endpoint próprio, então o teste pede uma URL (`{ url }` no corpo) e faz um GET autenticado por ela, pelo `http-guard`.
- **Binários:** `BinaryStore` (S3 compatível, `@aws-sdk/client-s3`) na API, entregue ao motor; `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` e `S3_BUCKET` passam a ser lidas pela API. Sem configuração S3, `putBinary` falha com mensagem clara.
- **Aviso de `maxRows`:** vai para o log da execução (pino, com `executionId` e `nodeId`), porque o contrato de saída não tem campo de aviso.
- **Limites de retry no contrato:** `retry.maxTries` ≤ 10 e `retry.waitMs` ≤ 60 000 em `workflowNodeSettingsSchema`. Sem cancelamento de execução até a spec 006, valores sem teto prenderiam a execução de teste na API.
- **`onError: continue`:** erro do nó inteiro emite um item `{ json: { error } }`. Os nós HTTP e Postgres (modo por item, sem transação) tratam erro por item: o item com erro vira `{ json: { error } }` ligado ao item de origem, e os demais seguem, como no N8N.

## Modelo de dados

`credentials`, conforme [modelo-dados.md](../../docs/arquitetura/modelo-dados.md).

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_MASTER_KEY` | — (obrigatória) | KEK base64 de 32 bytes (provedor `env`) |
| `OLLY_KEY_PROVIDER` | `env` | Provedor da chave mestra |
| `OLLY_HTTP_ALLOWLIST` | vazio | Hosts/CIDRs internos liberados |
| `OLLY_HTTP_MAX_RESPONSE_MB` | 50 | Limite de resposta |
| `OLLY_PG_POOL_MAX` | 5 | Conexões por credencial |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Envelope encryption | Chave única | Permite rotação de KEK sem recifrar os dados (spec 009) |
| Validação de IP no `lookup` | Validar só a URL | Protege contra DNS rebinding |
| Proibir expressão em `query` | Sanitizar | Eliminação do vetor em vez de mitigação |

## Permissões RBAC

Regra geral (decisão de 03/10/2026): cada spec é responsável pelas permissões que introduz: aplicá-las nas rotas (`@RequirePermission`), garantir que constem do catálogo (`packages/shared-types/src/rbac.ts`), do seed de papéis e de `docs/arquitetura/contratos.md`, e testar o acesso negado por papel.

| Permissão | Situação no catálogo/seed | Papéis com a permissão | O que esta spec faz |
|---|---|---|---|
| `credential:manage` | Já presente desde a spec 001 | admin, editor | Exigir nas rotas de gestão (criar, editar, excluir, testar) |
| `credential:use` | Já presente desde a spec 001 | admin, editor | Exigir para listar credenciais e usá-las em nós e na introspecção do Postgres |

Executor e visualizador não recebem nenhuma das duas. Nenhuma permissão nova é criada; se surgir uma, ela entra no catálogo, no seed e em `contratos.md` nesta spec.

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001 | Unidade | `crypto.test.ts` (round-trip, tag adulterada falha) |
| FR-002, FR-003 | Integração | `credential-leak.int.test.ts` (busca do valor sentinela em respostas, logs e banco) |
| FR-005, FR-006, FR-007 | Integração | `credentials.int.test.ts` |
| FR-008 | Unidade | `http-guard.test.ts` (127.0.0.1, 10.0.0.1, 169.254.169.254, [::1], domínio → IP privado, redirect) |
| FR-009, FR-010 | Integração | `http-request.int.test.ts` |
| FR-011, FR-012, FR-013 | Integração | `postgres-query.int.test.ts` (injeção, `readOnly`) |
| FR-014, FR-015 | Integração | `postgres-write.int.test.ts` (rollback, upsert) |
| FR-017, FR-018 | Integração | `resilience.int.test.ts` (backoff, `pg_sleep` + timeout) |
| FR-016 | E2E | `integrations.spec.ts` |

## Riscos

| Risco | Mitigação |
|---|---|
| Vazamento de segredo por caminho não previsto | Teste de varredura com valor sentinela em todos os destinos |
| Pools de conexão esgotando o banco externo | Limite por credencial e fechamento de pools ociosos |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Seção "Permissões RBAC" e tarefa T089 | Decisão humana: cada spec acrescenta e garante as permissões que cria |
| 04/10/2026 | Detalhes de implementação definidos no início da implementação (ver §10) | Lacunas do plano encontradas ao implementar |
