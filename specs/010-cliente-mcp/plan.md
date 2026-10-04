# Plano técnico — Spec 010: Cliente MCP

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Cliente:** `packages/mcp-client` sobre o SDK oficial `@modelcontextprotocol/sdk` (versão estável mais recente; consultar a especificação vigente em modelcontextprotocol.io).
- **Governança:** catálogo e políticas no banco, com snapshot das tools para detectar *rug pull*.
- **Transportes:** HTTP/SSE via `http-guard`; stdio em container efêmero.
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
| `infra/mcp-test-server` | Novo |

## Design

### §1 Catálogo e políticas
- **`mcp_servers`:**
  - `id`, `name`, `description`;
  - `transport` (`streamableHttp` | `sse` | `stdio`), `url`, `image`, `command`, `args`, `credential_id`;
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
- **Transportes:**
  - `StreamableHTTPClientTransport` e `SSEClientTransport` com `fetch` = `guardedFetch` (spec 004);
  - **stdio:** worker → `ContainerStdioLauncher` → container efêmero (`docker run --rm -i --network <política> --read-only --cap-drop ALL <image>`; no Kubernetes, um Job/Pod efêmero via adapter) conectado por stdin/stdout. Interface `StdioLauncher` para trocar a implementação conforme a ADR-0006.
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
- Transportes Streamable HTTP e stdio (imagem Docker).
- Flag de ambiente `MUTATE_SCHEMA=1` altera o schema de `soma` (teste de snapshot).

## Modelo de dados

Tabelas `mcp_servers`, `mcp_tool_policies` e `mcp_calls`.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_MCP_CALL_TIMEOUT_MS` | 60000 | Timeout por chamada |
| `OLLY_MCP_MAX_RESULT_MB` | 10 | Tamanho máximo do resultado |
| `OLLY_MCP_STDIO_LAUNCHER` | `docker` | `docker` \| `kubernetes` |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Negado por padrão | Liberado por padrão | Superfície mínima para agentes |
| Snapshot com bloqueio | Confiar no servidor | Mitiga *tool poisoning*/*rug pull* |
| stdio em container | Processo no worker | Isola código de terceiros |

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
| FR-004, FR-005 | Integração | `mcp-transports.int.test.ts` (SC-001, SC-005) |
| FR-006 | Integração | Timeout e cancelamento |
| FR-007 | Integração | `mcp-oauth.int.test.ts` com Keycloak dev (SC-006) |
| FR-008–FR-010 | Unidade + integração | `mcp-client-node.test.ts` (SC-004) |
| FR-011 | Integração | `mcp-calls.int.test.ts` (SC-007) |

## Riscos

| Risco | Mitigação |
|---|---|
| Evolução da especificação MCP | Encapsular o SDK em `packages/mcp-client`; registrar a versão |
| Docker indisponível no ambiente-alvo | `StdioLauncher` com adapter Kubernetes |

Ao concluir, produzir `docs/mcp-governanca.md` (catálogo, políticas, snapshot, ameaças).

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Seção "Permissões RBAC" e tarefa T089 | Decisão humana: cada spec acrescenta e garante as permissões que cria |
