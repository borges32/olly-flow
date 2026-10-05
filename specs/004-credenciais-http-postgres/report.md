# Relatório — Spec 004: Credenciais, HTTP Request e PostgreSQL

**Status:** Verificada (revisão humana em 04/10/2026)
**Data:** 04/10/2026

## Resumo

- **Credenciais cifradas por projeto:**
  - *envelope encryption* AES-256-GCM, com chave de dados por credencial e `KeyProvider` `env` (substituível; ADR-0007 pendente);
  - seis tipos: Bearer, Basic, header, query, OAuth2 client credentials e PostgreSQL;
  - tela de gestão com teste de conexão e auditoria sem valores.
- **Segredos:** nunca saem da API. Na execução, são mascarados em tudo que é gravado ou transmitido, comprovado por uma varredura com valores sentinela.
- **Filtro anti-SSRF** em toda saída HTTP: valida cada IP no `lookup` da conexão (contra DNS rebinding) e revalida cada redirect.
- **Nós novos:**
  - `http.request`, com corpos, autenticação, binário no MinIO, lotes e limite de resposta;
  - `postgres.query`, com SQL só parametrizado e transação somente leitura;
  - `postgres.write`, que insere, atualiza ou faz upsert, com identificadores validados e transação tudo ou nada.
- **Resiliência por nó:** retry com backoff, timeout que interrompe a operação, e `onError: continue`, com aba Configurações no editor.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `0005_credentials`. Também `0004_node_reused` (da spec 003, já relatada) |
| T002 | ✅ | `@testcontainers/postgresql` em `packages/nodes` e `packages/engine` (`vitest.integration.config.ts`). O servidor HTTP de teste é um `node:http` local liberado na allowlist, sem container |
| T010 | ✅ | `packages/db/src/crypto.ts`. O id da credencial entra como AAD |
| T011 | ✅ | `packages/nodes/src/credentials/` (definições + `CredentialTypeRegistry`) |
| T012 | ✅ | `packages/nodes/src/shared/http-guard.ts` |
| T013 | ✅ | `packages/engine/src/run.ts` (`runAttempt`, `executeWithResilience`) |
| T020 | ✅ | `apps/api/src/credentials/` |
| T021 | ✅ | `credential.create/update/test/delete` |
| T022 | ✅ | Mascaramento no motor (`redact.ts`) + caminhos no *pino redact* |
| T023 | ✅ | `credential-leak.int.test.ts` |
| T024 | ✅ | `/credentials` e campo **Credencial** no painel do nó |
| T030 | ✅ | Binário via `BinaryStore` (S3) da API |
| T031 | ✅ | `OAuth2TokenCache` |
| T032 | ✅ | `http-request.test.ts` (servidor local, sem container) |
| T040 | ✅ | `PoolManager` |
| T041 | ✅ | |
| T042 | ✅ | |
| T043 | ✅ | Endpoints de catálogo + `x-load-options` no formulário |
| T044 | ✅ | |
| T050 | ✅ | Aba Configurações |
| T089 | ✅ | `credential:manage`/`credential:use` já estavam no catálogo e no seed (admin, editor); 403/404 testados por papel |
| T090 | ✅ | Ver "Comandos de verificação" |
| T091 | ✅ | `apps/web/e2e/integrations.spec.ts` |
| T092 | ✅ | `docs/nos/http.request.md`, `postgres.query.md`, `postgres.write.md`, `docs/credenciais.md`. Também atualizados: `docs/nos/README.md`, `docs/arquitetura/contratos.md`, `docs/arquitetura/modelo-dados.md` e `README.md` |
| T093 | ✅ | Este relatório |

## Requisitos

Os testes citam `spec 004` no título (ou no `describe`).

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `packages/db/src/crypto.test.ts` (round-trip, DEK por credencial, tag adulterada, outra chave, outro id); `credentials.int.test.ts` › "FR-001: os dados ficam cifrados no banco"; `apps/api/src/config/config.test.ts` (API não sobe sem chave válida); `migrations.int.test.ts` (0005 reversível) |
| FR-002 | Sim | `credentials.int.test.ts` › "FR-002: cria e lista sem devolver segredos"; `credential-leak.int.test.ts` |
| FR-003 | Sim | `credential-leak.int.test.ts` (respostas, logs em nível *trace* e todas as tabelas); `packages/engine/src/resilience.test.ts` › "FR-003: segredos são mascarados…" e "mensagem de erro…"; `http-request.test.ts` › "FR-003: erro do servidor de autorização não ecoa…" |
| FR-004 | Sim | `credentials.int.test.ts` › "FR-004: valida os dados pelo tipo…" e "GET /credential-types…"; `http-request.test.ts` › "FR-004/FR-009: Basic, header e query…" e "OAuth2 client credentials"; `integrations.spec.ts` |
| FR-005 | Sim | `credentials.int.test.ts` › "FR-005: Postgres conecta…" e "tipos HTTP testam com uma URL…"; `postgres-query.int.test.ts` › "FR-005"; `integrations.spec.ts` |
| FR-006 | Sim | `credentials.int.test.ts` › "FR-006: criar, alterar, testar e excluir ficam na auditoria, sem os valores" |
| FR-007 | Sim | `credentials.int.test.ts` › "FR-007/T089…" (403 executor/visualizador, 404 de fora) e "uso de credenciais em workflows" (salvar exige `credential:use`, projeto e tipo; execução sem `credential:use` só da versão salva; credencial de outro projeto não é entregue); `resilience.test.ts` › "FR-007"; `store.test.ts` › "FR-007" |
| FR-008 | Sim | `packages/nodes/src/shared/http-guard.test.ts` (16 faixas, DNS→IP privado, DNS rebinding, redirect, allowlist); `http-request.test.ts` › "FR-008/HU-2.2"; `integrations.spec.ts` › "FR-008/HU-2.2" |
| FR-009 | Sim | `http-request.test.ts` (métodos, query, headers, corpos JSON/form/multipart/raw, autenticação, resposta completa, formatos, `neverError`, lotes) |
| FR-010 | Sim | `http-request.test.ts` › "FR-010"; `apps/api/src/binary/binary.int.test.ts` (MinIO real) |
| FR-011 | Sim | `postgres-query.int.test.ts` › "FR-011…" (once, perItem, maxRows) |
| FR-012 | Sim | `postgres-query.int.test.ts` › "FR-012…"; `packages/engine/src/validate.test.ts` › "FR-012" (recusado ao salvar); `integrations.spec.ts` (sem alternador de expressão) |
| FR-013 | Sim | `postgres-query.int.test.ts` › "FR-013…"; `postgres-write.int.test.ts` › "caso de borda: credencial somente leitura…" |
| FR-014 | Sim | `postgres-write.int.test.ts` (insert em lote, manual, update, upsert, skipOnConflict, RETURNING) |
| FR-015 | Sim | `postgres-write.int.test.ts` › "FR-015…" (tabela, colunas, retorno inexistentes; nomes com aspas) |
| FR-016 | Sim | `postgres-query.int.test.ts` › "FR-016"; `credentials.int.test.ts` › "FR-016"; `integrations.spec.ts` (tabela escolhida em lista carregada do banco) |
| FR-017 | Sim | `packages/engine/src/resilience.test.ts` (retry exponencial, esgotado, `onError: continue`); `packages/engine/src/resilience.int.test.ts` (com Postgres real); `test-run.int.test.ts` › "spec 004 — FR-017: tentativas…"; `http-request.test.ts`, `postgres-*.int.test.ts` (erro por item); `store.test.ts`; `integrations.spec.ts` › "FR-017" |
| FR-018 | Sim | `resilience.test.ts` › "FR-018" (timeout aborta nó que ignora o sinal; cancelamento interrompe a espera); `resilience.int.test.ts` (timeout cancela `pg_sleep` no servidor); `postgres-query.int.test.ts` › "SC-006/FR-018", "FR-018: abortar o sinal…"; `http-request.test.ts` › "FR-018…" |
| NFR-001 | Sim | `http-request.test.ts` › "FR-018/NFR-001" (limite de resposta); padrões 50 MB e 30 s em `config.test.ts` e na definição do nó |
| NFR-002 | Sim | `postgres-query.int.test.ts` › "NFR-002" (reuso, máximo, troca por versão, fechamento de ociosos) |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `apps/web/e2e/integrations.spec.ts` › "SC-001…": cria a credencial na tela, testa, associa nos nós, escolhe a tabela pelo catálogo, executa `Manual → HTTP → Postgres Insert → Postgres Query` e confere as linhas |
| SC-002 | ✅ | `credential-leak.int.test.ts`: 7 valores sentinela (+ Basic em base64), servidor que ecoa cabeçalhos e devolve o token no erro, logs em *trace*; nenhuma ocorrência em respostas, logs, `node_executions`, `executions`, `audit_log`, `workflow_versions` e `credentials` |
| SC-003 | ✅ | `http-guard.test.ts`: loopback, privados (10/8, 172.16/12, 192.168/16), 169.254.169.254, CGNAT, 0.0.0.0, broadcast, multicast, `::1`, `::`, `fe80::`, `fc00::`, `::ffff:127.0.0.1`, NAT64, 6to4 |
| SC-004 | ✅ | `postgres-query.int.test.ts` e `postgres-write.int.test.ts` › "SC-004" |
| SC-005 | ✅ | `postgres-write.int.test.ts` › "SC-005/HU-3.3" |
| SC-006 | ✅ | `postgres-query.int.test.ts` › "SC-006/FR-018"; `resilience.int.test.ts` |

## Comandos de verificação

Executados em 04/10/2026.

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 396 testes (expressions 106, nodes 103, engine 47, web 51, api 18, shared-types 12, task-runner 6, db 5, repositório 48) |
| `pnpm test:integration` | ✅ 143 testes (api 99, nodes 23, db 18, engine 3) |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 22 testes (3 novos da spec 004) |
| `docker compose up -d && pnpm smoke` | ✅ |
| `pnpm audit --audit-level=high` | ✅ 0 altas; 1 moderada (`uuid`, via Testcontainers, só em testes; já registrada) |
| `pnpm app:up` | ✅ imagem da API sobe com as dependências novas e a migration 0005 |

## Decisões tomadas

Registradas no plano (§10, "Histórico de alterações" de 04/10/2026):

- **`ctx.getCredential()`:** devolve `{ id, type, data, updatedAt }`, e não só os dados. O `http.request` aceita vários tipos e o pool usa `id:updatedAt`. Mudança de contrato central (constituição IX.3), registrada em `contratos.md`.
- **Mascaramento em profundidade (FR-003):**
  - a API entrega ao motor os valores secretos de cada credencial usada;
  - os nós registram segredos derivados (`helpers.registerSecret`, ex.: token OAuth2);
  - o motor troca tudo isso por `***` nos registros entregues ao `ExecutionRecorder` (log e WebSocket), nas mensagens de erro e nos logs dos nós;
  - os dados entre os nós não mudam (constituição VIII.2);
  - segredos com menos de 4 caracteres não são mascarados (trocariam trechos comuns do texto).
- **Uso de credencial (FR-007):**
  - **Ao salvar:** associar uma credencial a um nó exige `credential:use`, e a credencial precisa ser do projeto e de um tipo aceito pelo nó.
  - **Na execução de teste:** sem `credential:use` (ex.: papel executor), um workflow com credenciais só roda se a definição for igual à salva (nós sem posição, conexões e pin data). Sem isso, quem não pode usar a credencial poderia trocar a URL e mandar o segredo para fora.
  - **Na execução:** a credencial precisa ser do projeto do workflow.
- **Teste de credencial dos tipos HTTP genéricos:** esses tipos não têm endpoint próprio, então o teste pede uma URL e faz um GET autenticado, pelo filtro anti-SSRF.
- **OAuth2:** campo extra `authentication` (`header` padrão, ou `body`) para o envio do client secret, já que servidores divergem.
- **Configuração dos nós:** `createBuiltinNodes(...)` recebe filtro, limite e pools da configuração da API. Os nós continuam sem estado global.
- **Novas extensões de `paramsSchema`:** `x-no-expression`, `x-multiline` e `x-load-options`. O salvamento recusa expressão em campo `x-no-expression` (`EXPRESSION_NOT_ALLOWED`).
- **Limites de retry no contrato:** `maxTries` ≤ 10 e `waitMs` ≤ 60 000. Sem cancelamento de execução até a spec 006, retry sem teto prenderia a execução de teste na API.
- **SSL `require` do Postgres:** segue o libpq e cifra sem verificar o certificado; `verify-full` verifica. A escolha é explícita do usuário e está documentada na credencial e em `docs/credenciais.md`.
- **Filtro anti-SSRF mais restritivo que a lista do plano:** aceita só endereços `unicast` (públicos). Isso bloqueia também faixas de documentação/benchmark e IPv6 que embute IPv4 (6to4, Teredo, NAT64). Num redirect para outra origem, `Authorization` e `Cookie` não seguem.
- **Varredura de logs:** `createApp` aceita um destino de log opcional, usado só pelo teste de vazamento.
- **`.env` local:** como a API exige `OLLY_MASTER_KEY`, o seu `.env` (ignorado pelo git) recebeu a chave fictícia de desenvolvimento do `.env.example`, com um comentário. O `README.md` explica o passo para quem já tinha `.env`.

## Desvios da spec/plano

- **Spec:** sem mudança de comportamento.
- **Plano:** recebeu a seção §10 com as decisões acima, antes do código (constituição I.3).
- **`maxRows`:** o aviso de truncamento vai para o log da execução (pino, com `executionId`), não "no resultado", porque o contrato de saída não tem campo de aviso. Registrado no plano §10.
- **Testes de HTTP:** rodam como teste de unidade, com servidor `node:http` local, em vez de Testcontainers (plano §9 citava um servidor fastify): mais rápido e sem dependência extra. O teste de MinIO usa Testcontainers.
- **Gravação das tentativas:** o primeiro relatório interno detectou que o recorder não gravava `node_executions.attempts`. Corrigido com teste antes da correção (constituição IV.4): `test-run.int.test.ts` › "spec 004 — FR-017: tentativas…".

## Dependências adicionadas

| Pacote | Versão | Motivo | Licença |
|---|---|---|---|
| `undici` | 8.11.2 | `lookup` customizado no `Agent`, necessário para validar o IP na conexão (anti-SSRF, DNS rebinding); `fetch` com `dispatcher` | MIT |
| `ipaddr.js` | 2.5.0 | Classificação de faixas IPv4/IPv6 (`range()`), CIDRs da allowlist | MIT |
| `pg` (em `@olly/nodes`) | 8.23.1 | Cliente dos nós Postgres (já usado por `@olly/db`) | MIT |
| `pg-cursor` | 2.22.1 | `maxRows` sem trazer o resultado inteiro para a memória (plano §6) | MIT |
| `@aws-sdk/client-s3` | 3.1146.0 | Binários no MinIO/S3 (FR-010; stack: "S3 compatível") | Apache-2.0 |
| `@testcontainers/postgresql`, `testcontainers` (dev) | 11.14.0 | Postgres "externo" e MinIO nos testes de integração (já usados por outros pacotes) | MIT |

## Pendências, bloqueios e riscos

- **[PRECISA ESCLARECIMENTO] (não bloqueante):** hosts/CIDRs internos da allowlist inicial de homologação. Implementado com o padrão do plano, allowlist vazia (`OLLY_HTTP_ALLOWLIST`).
- **ADR-0007 (Vault/KMS) pendente:** implementado o `KeyProvider` `env` (constituição VI.2). O provedor institucional e a rotação de chave mestra entram na spec 009. O `key_version` já é gravado.
- **Cancelamento pelo usuário:** o motor e os nós respeitam o `AbortSignal` (timeout e cancelamento testados), mas o botão/endpoint de cancelar é da spec 006.
- **Eventos WebSocket:** não são varridos diretamente no teste de vazamento. Eles carregam os mesmos registros já mascarados pelo motor antes do recorder, e o banco, que recebe os mesmos dados, é varrido.
- **Credencial excluída:** os nós que a usam falham na execução com "Credencial não encontrada neste projeto". Referências que não mudaram não são revalidadas ao salvar.
- Continua a vulnerabilidade moderada do `uuid` (Testcontainers, só testes).

## Como demonstrar

```bash
pnpm app:up             # ou: docker compose up -d --wait && pnpm build && pnpm db:migrate && pnpm db:seed && pnpm dev
```

1. Como `admin@olly.local`, crie um projeto e adicione `editor@olly.local` como Editor.
2. Como editor, abra **Credenciais**, escolha o projeto e crie uma credencial **PostgreSQL**:
   - nos containers (`pnpm app:up`): host `postgres`, banco `olly`, usuário `olly`, senha `olly`;
   - no `pnpm dev`: host `localhost`.

   Clique em **Testar** (ícone de tomada): "Conexão bem-sucedida". Clique em **Editar**: a senha aparece vazia ("deixe em branco para manter").
3. Num workflow, adicione **PostgreSQL: consulta** com `CREATE TABLE demo (id serial PRIMARY KEY, nome text)`, escolha a credencial no painel e execute o nó (▶).
4. Monte **Gatilho manual → Requisição HTTP → PostgreSQL: gravar → PostgreSQL: consulta**:
   - HTTP: uma API pública que devolva uma lista de objetos com `nome`. Num ambiente sem internet, use pin data no gatilho e um **Definir campos** no lugar do HTTP.
   - Gravar: escolha a credencial e a tabela `demo` na lista carregada do banco.
   - Consulta: `SELECT * FROM demo`. O campo SQL não tem o alternador de expressão.

   Execute o workflow.
5. **Anti-SSRF:** num nó HTTP, use a URL `http://169.254.169.254/latest/meta-data`. A execução falha com "Destino bloqueado pelo filtro de rede".
6. **Configurações:** na aba **Configurações** do nó HTTP, ligue as novas tentativas e "Continuar". Execute com uma URL que falhe: o nó termina com um item `{ error }` e o fluxo segue.
7. **Segredos:** `SELECT data_encrypted FROM credentials` mostra só o envelope cifrado. A auditoria registra `credential.*` sem valores: `SELECT action, details FROM audit_log WHERE entity_type = 'credential'`.

## Próximos passos sugeridos

- Rotação de chave mestra e provedor Vault/KMS (spec 009, ADR-0007).
- Cancelar execução pela UI (spec 006).
- Teste automático da credencial ao salvar (como no N8N), além do botão Testar.
- Paginação HTTP (spec 008) e porta de erro `errorOutput` (spec 007).
- Allowlist por projeto, se a homologação mostrar necessidade.
