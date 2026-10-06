# Plano técnico — Spec 010: Cliente MCP

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Cliente:** `packages/mcp-client` sobre o SDK oficial `@modelcontextprotocol/sdk` (versão estável mais recente; consultar a especificação vigente em modelcontextprotocol.io).
- **Governança:** catálogo e políticas no banco, com snapshot das tools para detectar *rug pull*.
- **Transportes:** somente HTTP (Streamable HTTP e SSE legado) via `http-guard`. O stdio ficou fora do escopo (spec, Histórico 05/10/2026).
- **Nó:** `ai.mcpClient` com formulário dinâmico.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| III.5 | `http-guard` nos transportes HTTP/SSE |
| III.7 | Tools negadas por padrão; snapshot; marcação destrutiva (usada na 011) |
| VIII.2 | Argumentos mascarados em `mcp_calls` |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/mcp-client` | Novo |
| `packages/db` | `mcp_servers`, `mcp_tool_policies`, `mcp_calls` |
| `apps/api` | Módulo `mcp` (catálogo, teste, tools, políticas, revisão de snapshot); callback OAuth |
| `packages/nodes` | `ai.mcpClient`; credenciais `mcpBearer`, `mcpHeaders`, `mcpOAuth` |
| `apps/web` | `/admin/mcp`; painel dinâmico do nó |
| `infra/mcp-test-server` | Novo (somente HTTP) |

## Design

### §1 Catálogo e políticas
- **`mcp_servers`:**
  - `id`, `name`, `description`;
  - `transport` (`streamableHttp` | `sse`), `url`, `credential_id`. O transporte `stdio` é recusado no cadastro (FR-005);
  - `scope`, `project_id`, `status` (`pending` | `active` | `disabled`);
  - `tools_snapshot` (JSONB), `snapshot_pending_diff` (JSONB);
  - `created_by`, `approved_by`.
- **`mcp_tool_policies`:** `server_id`, `project_id` (NULL = global), `tool_name`, `allowed`, `destructive`. A política de projeto prevalece sobre a global. Sem registro = negado.
- **API `/api/v1/mcp-servers`** (`mcp:manage`, exceto a listagem para uso, que exige `credential:use`):
  - CRUD;
  - `POST /:id/test` (`initialize` + capacidades);
  - `POST /:id/approve` (grava o snapshot);
  - `GET /:id/tools?projectId=` (tools + política + flag de divergência);
  - `PUT /:id/policies`;
  - `POST /:id/snapshot/accept` (aceita o diff pendente).
- Permissão `mcp:manage` adicionada ao seed do admin e à matriz RBAC.

### §2 Detecção de mudança (snapshot)
- A cada conexão nova, `listTools` é comparado com `tools_snapshot` (hash de `name + description + inputSchema` canônico).
- Uma tool **liberada** com divergência:
  - grava `snapshot_pending_diff`;
  - bloqueia as chamadas com `McpToolChangedError`.

  Tools novas permanecem negadas (sem bloqueio geral).
- A UI mostra o diff (descrição e schema) e o botão "Aceitar mudança".

### §3 `packages/mcp-client`
- **`McpConnectionPool`:** uma conexão por `server_id`, com *idle timeout* (5 min), reconexão e *handshake* `initialize`.
- **Operações:** `listTools` / `listResources` / `listPrompts` (seguindo `nextCursor`), `callTool`, `readResource` e `getPrompt`.
- **Transportes:** `StreamableHTTPClientTransport` e `SSEClientTransport` com `fetch` = `guardedFetch` (spec 004). Sem stdio nesta versão: nenhum processo de servidor MCP é executado pela plataforma.
- **Timeout:** `OLLY_MCP_CALL_TIMEOUT_MS` (60 000) e `AbortSignal`. No cancelamento, envia `notifications/cancelled`.
- **Resultado:** acima de `OLLY_MCP_MAX_RESULT_MB` (10), gera erro.

### §4 Autenticação
- **`mcpBearer`:** `token`. **`mcpHeaders`:** `headers[]` com valores secretos.
- **`mcpOAuth`:**
  - *discovery* (`/.well-known/oauth-protected-resource` → servidor de autorização);
  - registro dinâmico de cliente quando suportado, ou `clientId` manual;
  - Authorization Code + PKCE com *redirect* `/api/v1/oauth/callback`;
  - armazena `access_token`/`refresh_token` cifrados na credencial;
  - *refresh* automático.
- Na tela da credencial, o botão "Conectar" abre um *popup* e mostra o status.

### §5 Nó `ai.mcpClient`
- **Parâmetros:**
  - `serverId`, `operation`;
  - `toolName` (somente as permitidas no projeto), `argumentsMode` (`form` | `json`), `arguments` (objeto) ou `argumentsJson` (expressão);
  - `resourceUri`, `promptName` e `promptArguments`.
- O formulário usa o renderizador da spec 002 com o `inputSchema` da tool. Cada campo tem o alternador Fixo/Expressão.
- **Por item:** resolve os argumentos, valida com ajv contra o `inputSchema`, verifica a política e o snapshot, chama e registra em `mcp_calls`.
- **Saída:**
  - `callTool` → `{ content, structuredContent?, isError }`. Itens `image`/`audio`/`resource` com blob vão para o MinIO como `binary`;
  - `isError = true` → `NodeExecutionError` (sujeito ao `onError`).
- `supportsParallelItems = true`.

### §6 Registro
- **`mcp_calls`:** `id`, `execution_id`, `node_id`, `run_index`, `item_index`, `server_id`, `tool_name`, `arguments` (mascarado com o `Masker`), `status`, `duration_ms`, `result_bytes`, `error`, `created_at`.
- Aba "Chamadas MCP" no painel do nó e na execução.
- Tool negada → `McpToolNotAllowedError` + `audit_log` (`mcp.tool_denied`, com o dono da execução).

### §7 Servidor de teste (`infra/mcp-test-server/`)
- TypeScript com o SDK.
- **Tools:** `echo`, `soma`, `consulta_cliente` (dados fictícios), `apagar_registro` e `erro` (retorna `isError`).
- Um resource (`test://info`) e um prompt (`saudacao`).
- Transporte Streamable HTTP (e SSE legado), com imagem Docker para a demonstração no compose.
- Flag de ambiente `MUTATE_SCHEMA=1` altera o schema de `soma` (teste de snapshot).

## Modelo de dados

Tabelas `mcp_servers`, `mcp_tool_policies` e `mcp_calls`.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_MCP_CALL_TIMEOUT_MS` | 60000 | Timeout por chamada |
| `OLLY_MCP_MAX_RESULT_MB` | 10 | Tamanho máximo do resultado |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Negado por padrão | Liberado por padrão | Superfície mínima para agentes |
| Snapshot com bloqueio | Confiar no servidor | Mitiga *tool poisoning*/*rug pull* |
| Somente HTTP nesta versão | stdio em container | Decisão humana (05/10/2026); o stdio exigiria um lançador de containers no ARO OpenShift (ADR-0006) |

## Permissões RBAC

Regra geral (decisão de 03/10/2026): cada spec é responsável pelas permissões que introduz: aplicá-las nas rotas (`@RequirePermission`), garantir que constem do catálogo (`packages/shared-types/src/rbac.ts`), do seed de papéis e de `docs/arquitetura/contratos.md`, e testar o acesso negado por papel.

| Permissão | Situação no catálogo/seed | Papéis com a permissão | O que esta spec faz |
|---|---|---|---|
| `mcp:manage` | **Nova**: não existe no catálogo | somente admin | Acrescentar ao catálogo, ao seed e a `contratos.md`; exigir na gestão do catálogo MCP |

Atenção: o seed deriva o editor como "todas as permissões, exceto as de administrador". Ao incluir `mcp:manage` no catálogo, inclua-a também na lista de permissões exclusivas do admin, senão o editor a recebe por consequência. O seed é idempotente: rodá-lo atualiza os papéis existentes. Atualizar `docs/rbac-matriz.md`.

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001, FR-002, FR-012 | Integração | `mcp-catalog.int.test.ts` (SC-002) |
| FR-003 | Integração | `mcp-snapshot.int.test.ts` (SC-003) |
| FR-004, FR-005 | Integração | `mcp-transports.int.test.ts` (SC-001, SC-005; cadastro recusa stdio) |
| FR-006 | Integração | Timeout e cancelamento |
| FR-007 | Integração | `mcp-oauth.int.test.ts` com Keycloak dev (SC-006) |
| FR-008–FR-010 | Unidade + integração | `mcp-client-node.test.ts` (SC-004) |
| FR-011 | Integração | `mcp-calls.int.test.ts` (SC-007) |

## Riscos

| Risco | Mitigação |
|---|---|
| Evolução da especificação MCP | Encapsular o SDK em `packages/mcp-client`; registrar a versão |

Ao concluir, produzir `docs/mcp-governanca.md` (catálogo, políticas, snapshot, ameaças).

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Seção "Permissões RBAC" e tarefa T089 | Decisão humana: cada spec acrescenta e garante as permissões que cria |
| 05/10/2026 | Sem stdio: `mcp_servers` sem `image`/`command`/`args`, sem `StdioLauncher` nem `OLLY_MCP_STDIO_LAUNCHER`; servidor de teste só HTTP | Spec, Histórico 05/10/2026 (decisão humana) |
| 05/10/2026 | §1: sem coluna `scope` (`project_id` nulo = global); `server_info` (capacidades) e `approved_at`; trocar URL, transporte, credencial ou escopo volta o servidor a pendente e descarta o snapshot; rotas extras `POST /:id/disable` e `GET /executions/:id/mcp-calls` (`execution:read`, argumentos só com `execution:readData`); `mcp:manage` só no escopo da plataforma (como `audit:read`, spec 009) | Escopo derivável; reaprovação evita trocar o servidor aprovado por outro |
| 05/10/2026 | §1: a credencial do catálogo pode ser de qualquer projeto num servidor global (escolha da administração da plataforma); a do nó prevalece na execução | Credenciais são por projeto; servidores globais servem a todos |
| 05/10/2026 | §2: o bloqueio compara, a cada chamada, o hash da tool anunciada pela sessão com o do snapshot (além da divergência gravada); a comparação também roda a cada `notifications/tools/list_changed`; só tools do snapshot podem ser liberadas | Pega a mudança mesmo numa sessão já aberta e entre workers |
| 05/10/2026 | §3: limite de tamanho aplicado ao corpo das respostas a POST enquanto chega (aborta só a chamada dona da resposta) e conferido no resultado; o `fetch` com anti-SSRF converte a resposta para a `Response` global e deixa os redirecionamentos com o SDK (mesma origem, cada salto revalidado) | Memória limitada e compatibilidade com o SDK |
| 05/10/2026 | §4: `mcpHeaders` com um único campo secreto multilinha (`Nome: valor` por linha), cada valor mascarado; `mcpOAuth` com `serverUrl`, `clientId` (vazio = registro dinâmico), `clientSecret` e os tokens em campos secretos ocultos; `state` e verificador PKCE no Redis por 10 min (uso único); rotas `POST /credentials/:id/oauth/authorize` (`credential:manage`) e `GET /credentials/:id/oauth/status` (`credential:use`); client `olly-mcp` no realm de desenvolvimento | O registro de credenciais trata segredos de primeiro nível; tokens nunca saem da API |
| 05/10/2026 | §5: contrato do nó: `NodeContext.runIndex` e `NodeContext.mcp()` (`McpGateway` de `@olly/nodes`), `RunOptions.mcp` no motor; extensão `x-mcp-arguments` e fontes `mcpServers`/`mcpTools` de `x-load-options`; "listar tools" devolve só as liberadas no projeto; formulário com coerção de tipos (texto das expressões), modo JSON sem coerção | O nó não acessa o banco: a governança fica no gateway da API (como as credenciais) |
| 05/10/2026 | §6: `mcp_calls` com `project_id` (retenção), `server_name`, `operation` e `target` (tool, URI ou prompt); todas as operações registradas; `isError` registrado como `error`; tool alterada auditada como `mcp.tool_blocked` | Rastreabilidade de toda chamada (FR-011) |
| 05/10/2026 | §7: tools extras no servidor de teste (`imagem`, `lento`, `grande`) e modos de autenticação (bearer, cabeçalho, OAuth com revogação de tokens) | Testes de FR-006, FR-007 e FR-010 |
