# Relatório — Spec 010: Cliente MCP

**Status:** Implementada (somente transportes HTTP, por decisão humana de 05/10/2026)
**Data:** 05/10/2026

## Resumo

- **Cliente MCP** (`packages/mcp-client`) sobre o SDK oficial, na especificação MCP **2025-11-25** (NFR-002):
  - transportes Streamable HTTP e SSE legado, todo o tráfego pelo filtro anti-SSRF;
  - conexões reaproveitadas, com timeout, cancelamento enviado ao servidor e limite de tamanho aplicado enquanto a resposta chega.
- **Catálogo governado** (`/admin/mcp`):
  - cadastro, teste e aprovação com snapshot das tools;
  - tools negadas por padrão, liberadas por servidor e projeto, com marcação de destrutiva;
  - bloqueio de tool liberada que muda (*rug pull*), com diff e "Aceitar mudança".
- **Nó Cliente MCP** (`ai.mcpClient`):
  - seis operações;
  - formulário gerado do schema aprovado da tool, com expressão por campo, ou JSON livre;
  - validação antes da chamada;
  - binários no object storage e `isError` seguindo o `onError`.
- **Autenticação:** token, cabeçalhos e OAuth 2.1 conforme a especificação MCP (descoberta, PKCE, registro dinâmico, renovação automática), com "Conectar" na tela.
- **Registro:** toda chamada com argumentos mascarados, no painel do nó; negações e bloqueios auditados.
- **Servidor MCP de teste** (HTTP) para testes e demonstração.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `infra/migrations/0010_mcp.{up,down}.sql` (o `CHECK` do banco também só aceita HTTP); `mcp:manage` no catálogo e nas permissões exclusivas do admin (`packages/shared-types/src/rbac.ts`) |
| T002 | ✅ | `infra/mcp-test-server` (workspace novo): Streamable HTTP em `/mcp`, SSE em `/sse`, `MUTATE_SCHEMA`, autenticação por bearer, cabeçalho ou OAuth; imagem `mcp-test-server` no `infra/docker/Dockerfile` e serviço `mcp-test` no compose |
| T010 | ✅ | `McpConnection` (handshake, paginação por `nextCursor`, timeout, cancelamento, limite) e `McpConnectionPool` (por chave, ociosidade de 5 min, descarte em falha de conexão ou autenticação) |
| T011 | ✅ | `guardedFetchLike`: adapta o `HttpGuard.fetch` (spec 004) ao SDK; limite do corpo das respostas a POST via `AsyncLocalStorage` |
| T012 | ➖ | Removida: stdio fora do escopo (spec, Histórico 05/10/2026). O cadastro recusa stdio (T020, teste FR-005) |
| T020 | ✅ | `apps/api/src/mcp/` (`McpCatalogService`, `McpController`); recusa do stdio com mensagem clara |
| T021 | ✅ | Comparação a cada conexão nova, a cada `tools/list_changed` e a cada chamada (hash); `snapshot_pending_diff`; `POST /mcp-servers/:id/snapshot/accept` |
| T022 | ✅ | `apps/web/src/pages/admin-mcp-page.tsx` (catálogo, teste, aprovação, políticas por escopo, destrutiva, diff); aba "MCP" na administração |
| T030 | ✅ | `packages/nodes/src/ai/mcp-client/` + `McpGateway` (`@olly/nodes`) implementado pela API (`McpGatewayFactory`) e entregue ao motor (`RunOptions.mcp` → `ctx.mcp()`) |
| T031 | ✅ | `x-mcp-arguments` (formulário do `inputSchema`, alternador Fixo/Expressão por campo) e `x-load-options` `mcpServers`/`mcpTools` |
| T032 | ✅ | `mcp_calls` (argumentos e erros mascarados), `GET /executions/:id/mcp-calls`, painel "Chamadas MCP" no nó; auditoria `mcp.tool_denied`/`mcp.tool_blocked` |
| T033 | ✅ | `mcp-catalog`, `mcp-snapshot`, `mcp-transports`, `mcp-calls` e `mcp-oauth` (`*.int.test.ts`) |
| T040 | ✅ | Tipos `mcpBearer`, `mcpHeaders`, `mcpOAuth`; `CredentialOAuthProvider`, `McpOAuthService`, callback `GET /api/v1/oauth/callback`; botão "Conectar" e status na tela de credenciais; client `olly-mcp` no realm de desenvolvimento |
| T089 | ✅ | Catálogo, seed, `contratos.md`; 403 de editor, executor e visualizador (`mcp-catalog.int.test.ts`); matriz RBAC regenerada |
| T090 | ✅ | Ver "Comandos de verificação" |
| T091 | ✅ | Tabelas abaixo |
| T092 | ✅ | `docs/nos/ai.mcpClient.md`, `docs/mcp-governanca.md`, `docs/rbac-matriz.md` |
| T093 | ✅ | Este relatório; status em `spec.md` e `docs/roadmap.md` |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `apps/api/src/mcp/mcp-catalog.int.test.ts` › "FR-001/HU-1.1: cadastra pendente, testa…", "FR-001: trocar a URL…", "FR-001: servidor pendente, desativado ou de outro projeto…", "T089/FR-001…"; `apps/web/e2e/mcp.spec.ts` › "FR-001/FR-002/HU-1.1…" |
| FR-002 | Sim | `mcp-catalog.int.test.ts` › "FR-002: sem política tudo é negado; a do projeto prevalece…", "FR-002: só tools do snapshot…" |
| FR-003 | Sim | `apps/api/src/mcp/mcp-snapshot.int.test.ts` › "FR-003/SC-003…", "FR-003: tool nova…"; `packages/mcp-client/src/snapshot.test.ts`; `mcp.spec.ts` › "FR-003/SC-003…" |
| FR-004 | Sim | `apps/api/src/mcp/mcp-transports.int.test.ts` › "SC-001…", "FR-004: SSE legado…", "SC-005…"; `packages/mcp-client/src/client.test.ts`, `fetch.test.ts` |
| FR-005 | Sim (removido; cadastro recusa stdio) | `mcp-catalog.int.test.ts` › "FR-005: o transporte stdio é recusado…"; `packages/db/src/migrations.int.test.ts` › "spec 010: down de 0010…" (`CHECK` sem stdio) |
| FR-006 | Sim | `mcp-transports.int.test.ts` › "FR-006: timeout por chamada…", "FR-006: cancelar a execução…", "FR-006: resultado acima…"; `client.test.ts` › "FR-006…" (pool, timeout, cancelamento, limite) |
| FR-007 | Sim | `mcp-transports.int.test.ts` › "FR-007: credencial mcpBearer… e mcpHeaders…"; `mcp-oauth.int.test.ts` › "SC-006…"; `mcp.spec.ts` › "FR-007/SC-006…"; `fetch.test.ts` › "FR-007: corpo URLSearchParams…" |
| FR-008 | Sim | `packages/nodes/src/ai/mcp-client/mcp-client.test.ts` › "FR-008…"; `mcp-transports.int.test.ts` › "FR-008: listar tools…, ler resource e obter prompt"; `packages/engine/src/mcp.test.ts` |
| FR-009 | Sim | `mcp-client.test.ts` › "FR-009/SC-004…", "FR-009: modo JSON…", "FR-009: campo opcional vazio…"; `apps/web/src/editor/schema-form-logic.test.ts` › "FR-009…"; `mcp.spec.ts` › "FR-009/SC-001…" |
| FR-010 | Sim | `apps/api/src/mcp/mcp-calls.int.test.ts` › "FR-010: a imagem devolvida vai para o object storage…", "FR-011/FR-010: isError…"; `mcp-client.test.ts` › "FR-010…" |
| FR-011 | Sim | `mcp-calls.int.test.ts` › "FR-011/SC-007…", "FR-011: chamadas de outra execução…"; `mcp.spec.ts` (painel "Chamadas MCP"); `apps/api/src/maintenance/retention.int.test.ts` (retenção) |
| FR-012 | Sim | `mcp-catalog.int.test.ts` › "FR-012/SC-002: tool não liberada é recusada no workflow e auditada"; `mcp-client.test.ts` › "FR-012…" |
| FR-013 | Sim | `infra/mcp-test-server/src/server.test.ts` › "FR-013…" |
| NFR-001 | Sim | `apps/api/src/config/config.test.ts` › "spec 010 — NFR-001/FR-006…" (60 s); `mcp-transports.int.test.ts` (timeout configurado) |
| NFR-002 | Sim | Especificação MCP **2025-11-25** (SDK `@modelcontextprotocol/sdk` 1.32.1; versões aceitas na negociação: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07). Os testes verificam o `protocolVersion` negociado |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ via HTTP (stdio fora do escopo) | `mcp-transports.int.test.ts` › "SC-001: soma via Streamable HTTP com argumentos de expressões" (42); E2E "FR-009/SC-001" |
| SC-002 | ✅ | `mcp-catalog.int.test.ts` › "FR-012/SC-002" (não chega ao servidor; `mcp.tool_denied` com o dono da execução; `mcp_calls` `denied`) |
| SC-003 | ✅ | `mcp-snapshot.int.test.ts` › "FR-003/SC-003" (bloqueio, diff, aceite) e E2E |
| SC-004 | ✅ | `mcp-transports.int.test.ts` › "SC-004" (o servidor não recebe a chamada); `mcp-client.test.ts` |
| SC-005 | ✅ | `mcp-transports.int.test.ts` › "SC-005" (169.254.169.254 no teste/aprovação; 10.0.0.7 na execução) |
| SC-006 | ✅ | `mcp-oauth.int.test.ts` (Keycloak real em Testcontainers: descoberta, PKCE, callback, token aceito pelo servidor e renovação após revogação) e E2E "Conectar" com o Keycloak do compose |
| SC-007 | ✅ | `mcp-calls.int.test.ts` › "FR-011/SC-007" (CPF mascarado no banco e na API; sem `execution:readData`, sem argumentos) |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ (inclui `prettier --check`) |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 582 testes (shared-types 20, db 8, nodes 149, expressions 124, web 66, task-runner 8, engine 109, api 31, mcp-client 12, mcp-test-server 4, raiz 51) |
| `pnpm test:integration` | ✅ 265 testes (api 216 em 36 arquivos, nodes 23, db 23, engine 3); Testcontainers com PostgreSQL, Redis, MinIO, Vault e, no OAuth, o IdP de desenvolvimento |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 34 testes (inclui `mcp.spec.ts`: catálogo, nó, diff e "Conectar") |
| `pnpm app:up` + `pnpm smoke` | ✅ (todos os serviços saudáveis, inclusive `mcp-test`; o admin tem 14 permissões globais) |
| `pnpm audit` | ⚠️ 1 achado moderado já conhecido (`uuid` via `testcontainers`, dependência de desenvolvimento) |

Observações:
- Na primeira rodada, o teste de desempenho NFR-002 da spec 003 (`expressions/sandbox.test.ts`, limite de 1 s) falhou uma vez com a suíte inteira em paralelo (1,15 s). Passou na rodada seguinte (0,46 s). Ele não foi alterado; a instabilidade sob carga já constava no relatório da spec 009.
- A matriz RBAC (`docs/rbac-matriz.md`) foi regenerada com as ações de MCP.

## Decisões tomadas

- **Governança no gateway da API, não no nó.**
  - O nó recebe um `McpGateway` (`ctx.mcp()`), como já acontece com as credenciais.
  - A API resolve o servidor (ativo e disponível no projeto), a política efetiva, o snapshot e a credencial. Ela também registra cada operação em `mcp_calls`, com o mascaramento do projeto, e audita negações.
  - Vale igual para a execução em processo e para os workers.
- **Bloqueio por mudança em três camadas:**
  - divergência gravada a cada conexão nova;
  - divergência gravada a cada `tools/list_changed`;
  - hash da tool conferido em toda chamada.
  - Assim, a mudança é pega mesmo numa sessão já aberta ou em outro worker. Só tools do snapshot podem ser liberadas.
- **`mcp:manage` só no escopo da plataforma**, como `audit:read` na spec 009. O papel admin de um projeto não administra o catálogo.
- **Credencial do catálogo** pode ser de qualquer projeto num servidor global, por escolha da administração da plataforma. A credencial do nó prevalece na execução.
- **Trocar URL, transporte, credencial ou escopo** volta o servidor a pendente e descarta o snapshot.
- **"Listar tools"** devolve só as tools liberadas no projeto e sem mudança pendente (negado por padrão).
- **OAuth:**
  - o SDK cuida da descoberta, do registro dinâmico, do PKCE e da renovação;
  - os tokens ficam em campos secretos ocultos da credencial, gravados com `FOR UPDATE` (API e workers podem renovar ao mesmo tempo);
  - o `state` e o verificador ficam no Redis (uso único, 10 min);
  - o callback é público e devolve uma página que avisa a janela de origem por `postMessage` (origem conferida).
- **Limite de tamanho:**
  - o corpo das respostas a POST é cortado enquanto chega, e só a chamada dona da resposta é abortada (`AsyncLocalStorage`). Sem isso, o SDK tentaria retomar o stream e a chamada esperaria o timeout;
  - o resultado também é conferido depois de chegar (o SSE legado entrega pelo stream GET).
- **Uso de API obsoleta do SDK:**
  - o SSE legado (`SSEClientTransport`/`SSEServerTransport`) é exigido pelo FR-004, mas o SDK o marca como `@deprecated`;
  - o uso está concentrado em um único ponto por pacote, com supressão pontual de `@typescript-eslint/no-deprecated` e justificativa (`-- FR-004`): `packages/mcp-client/src/connection.ts`, `infra/mcp-test-server/src/server.ts` e `server.test.ts`;
  - **é o único lugar do repositório com supressão de lint e pede sua confirmação** (constituição III.8). A alternativa é um transporte SSE próprio.

## Desvios da spec/plano

Registrados antes no "Histórico de alterações":
- **`spec.md` (decisão humana, 05/10/2026):**
  - somente HTTP: FR-005 removido (o cadastro recusa stdio);
  - FR-004, FR-013 e SC-001 só com HTTP;
  - stdio em "Fora do escopo".
- **`plan.md`:**
  - sem stdio (`StdioLauncher`, `OLLY_MCP_STDIO_LAUNCHER`, colunas `image`/`command`/`args`; T012 removida);
  - §1 a §7: decisões acima, rotas extras (`disable`, `mcp-calls`, OAuth `authorize`/`status`), `mcpHeaders` em um campo multilinha, `mcp_calls` com `project_id`/`operation`/`target` e tools extras no servidor de teste (`imagem`, `lento`, `grande`).
- **Contratos (`docs/arquitetura/contratos.md`):**
  - `NodeContext.runIndex`, `NodeContext.mcp()` e `RunOptions.mcp`;
  - extensão `x-mcp-arguments`;
  - fontes `mcpServers`/`mcpTools`;
  - seção "Cliente MCP".
- **Ajustes em código de specs anteriores:**
  - `CredentialsService` ganhou `resolveById` e `patchData` (uso interno);
  - a retenção (spec 009) passou a apagar `mcp_calls` com os metadados da execução (`retention.int.test.ts`);
  - o formulário de credenciais deixou de exibir campos `x-hidden`;
  - o teste de credencial recusa os tipos MCP com mensagem clara;
  - o compose libera `mcp-test` na allowlist padrão do desenvolvimento;
  - a allowlist do E2E (Playwright) ganhou `localhost`, para o OAuth com o Keycloak do compose.

**Testes de specs anteriores ajustados ao comportamento novo**, sem enfraquecer o que verificam:
- `packages/shared-types/src/rbac.test.ts` (spec 001): o editor também não tem `mcp:manage`.
- `credentials.int.test.ts` (spec 004) e `workflows.int.test.ts` (spec 002): as listas exatas de tipos de credencial e de nós incluem os tipos MCP e o `ai.mcpClient`.
- `retention.int.test.ts` (spec 009): verifica também a remoção de `mcp_calls`.
- `migrations.int.test.ts`: migration `0010_mcp`.

O teste da spec 001 que proíbe citar o fornecedor do IdP no código das apps (FR-008) barrou a primeira versão do teste de OAuth. Agora ele lê a imagem, o comando e o realm do IdP de desenvolvimento do `docker-compose.yml`.

**Correção encontrada pelos testes durante a implementação:** o SDK envia o corpo das requisições de token OAuth como `URLSearchParams`, e o adaptador de `fetch` só repassava texto (o Keycloak respondia "Missing form parameter: grant_type"). O teste que reproduz o problema veio antes da correção (`packages/mcp-client/src/fetch.test.ts`).

## Dependências adicionadas

| Pacote | Versão | Motivo | Licença |
|---|---|---|---|
| `@modelcontextprotocol/sdk` (`@olly/mcp-client`, `@olly/mcp-test-server`) | 1.32.1 | SDK oficial do MCP (cliente, OAuth e servidor de teste); previsto na stack (`docs/arquitetura/stack.md`). Traz transitivamente `express`, `hono`, `cors`, `eventsource` e `pkce-challenge`, usados pelo lado servidor e pelos transportes | MIT |
| `zod` (`@olly/mcp-test-server`) | 4.6.5 | Schemas das tools do servidor de teste (já usado no repositório) | MIT |
| `jose` (`@olly/mcp-test-server`) | 6.2.12 | Validação dos JWT no modo OAuth do servidor de teste (já usado na API) | MIT |

## Pendências, bloqueios e riscos

- **Pré-requisito humano (desejável):** a lista de servidores MCP internos do catálogo inicial não foi fornecida; o catálogo começa vazio.
- **Supressão de lint do SSE legado:** aguarda confirmação (ver Decisões).
- **Spec 012:** o `plan.md` dela cita "o launcher stdio do MCP usa um adapter Kubernetes (Jobs)", que deixou de existir. Ajustar quando a 012 for implementada.
- **OAuth no modo `pnpm app:up`:**
  - o servidor de autorização do realm de desenvolvimento é anunciado como `http://localhost:8080`, que a API em container não alcança (`localhost` é o próprio container);
  - o fluxo funciona com `pnpm dev`, nos testes de integração (Keycloak em Testcontainers) e no E2E;
  - em homologação, o IdP real (ADR-0005) tem endereço único.
- **Servidor de autorização anunciado pelo servidor MCP:** o "Conectar" segue o que os metadados do servidor indicam. O usuário vê o endereço no popup, e as chamadas da plataforma ao servidor de autorização passam pelo anti-SSRF.
- **Keycloak de desenvolvimento:** o realm ganhou o client `olly-mcp`. Um Keycloak já criado precisa ser recriado (`docker compose up -d --force-recreate keycloak`).
- **Herdadas:** a 006, a 007 e a 009 continuam `Implementada` (não `Verificada`); a 008 não foi implementada.

## Como demonstrar

Ambiente: `pnpm app:up`. Ele sobe também o servidor MCP de teste em `http://mcp-test:3333/mcp`, que no compose já está liberado no anti-SSRF.

1. **Catálogo (HU-1):**
   - como `admin@olly.local`, abra **Administração › MCP** e use **Novo servidor**: nome "Teste", Streamable HTTP, URL `http://mcp-test:3333/mcp`;
   - **Testar** mostra protocolo 2025-11-25, capacidades e tools;
   - **Aprovar** grava o snapshot;
   - clique no nome do servidor, marque **Liberar soma** e salve.
2. **Nó (HU-2):**
   - como admin ou editor de um projeto, crie o workflow Manual → **Cliente MCP**;
   - escolha o servidor e a tool `soma`, que é a única na lista;
   - preencha `a` e `b` no formulário (teste também uma expressão) e execute;
   - abra o nó: a saída traz o resultado e o painel "Chamadas MCP" mostra a chamada.
3. **Tool não liberada (SC-002):** troque a tool para `apagar_registro`. A tool não aparece na lista; no modo JSON com `toolName` fixo pela API, a execução falha com "não está liberada", e **Administração › Auditoria** mostra `mcp.tool_denied`.
4. **Mudança de schema (SC-003):**
   - rode `MCP_TEST_MUTATE_SCHEMA=1 docker compose --profile app up -d mcp-test` e execute o workflow: ele fica bloqueado;
   - em **Administração › MCP**, o servidor aparece com "Mudança pendente"; o diff mostra a descrição com a instrução maliciosa e o campo `c`;
   - **Aceitar mudança** libera o uso.
5. **Argumentos inválidos (SC-004):** preencha `a` com "x". O erro aparece antes de qualquer chamada.
6. **Anti-SSRF (SC-005):** cadastre um servidor com URL `http://169.254.169.254/mcp` e use **Testar**: aparece "Destino bloqueado pelo filtro de rede".
7. **OAuth (SC-006), com `pnpm dev`:**
   - suba o servidor de teste protegido: `MCP_OAUTH_ISSUER=http://localhost:8080/realms/olly MCP_OAUTH_AUDIENCE=olly-mcp-test PORT=3334 HOST=127.0.0.1 node infra/mcp-test-server/dist/main.js`;
   - libere `127.0.0.1,localhost` em `OLLY_HTTP_ALLOWLIST`;
   - crie uma credencial **MCP: OAuth 2.1** com URL `http://127.0.0.1:3334/mcp` e Client ID `olly-mcp`, e use **Conectar**: a credencial fica "Conectada".

## Próximos passos sugeridos

- **Transporte stdio** em container isolado, numa spec própria. Exige definir o lançador no ARO OpenShift (ADR-0006).
- **Tools MCP nos agentes (spec 011):** usar `listTools` do gateway e a marcação de destrutiva para a aprovação humana.
- **Revisão de servidores:** notificação aos administradores quando surgir uma mudança pendente. Hoje ela aparece na tela e no log.
- **Visualização de `mcp_calls`** na página de execuções (filtro por servidor ou tool) e no painel de auditoria.
