# Sprint 9 — Cliente MCP

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Leia também os relatórios em `docs/relatorios/` e a seção 6.10 de `docs/analise_implementacao.md`. Consulte a especificação vigente do Model Context Protocol (modelcontextprotocol.io) e a documentação do `@modelcontextprotocol/sdk`. Use a versão estável mais recente do SDK e registre a versão da especificação adotada.

## Pré-requisitos

- Sprint 8 concluída e todos os comandos da seção 8 passando.

## Contexto

Servidores MCP expõem *tools*, *resources* e *prompts* que workflows e agentes vão consumir. Servidores MCP podem executar ações com efeitos reais e retornar conteúdo não confiável, então o acesso é governado:
- catálogo aprovado pelo administrador;
- allowlist de tools;
- auditoria de cada chamada.

O nó desta sprint funciona de forma **standalone** e será reutilizado como *tool provider* do AI Agent na Sprint 10.

## Objetivo

Catálogo de servidores MCP, cliente com os transportes Streamable HTTP, SSE e stdio (restrito), autenticação OAuth, nó `ai.mcpClient` e auditoria das chamadas.

## Tarefas

### T1 — Catálogo de servidores MCP
- Tabela `mcp_servers`:
  - `id`, `name`, `description`;
  - `transport` (`streamableHttp` | `sse` | `stdio`);
  - `url` (HTTP), `command`/`args`/`image` (stdio), `credential_id`;
  - `status` (`active` | `disabled`), `scope` (`global` | `project`), `project_id`;
  - `created_by`, `approved_by`.
- Tabela `mcp_tool_policies`: `server_id`, `project_id` (NULL = global), `tool_name`, `allowed: boolean`, `destructive: boolean`. A marcação `destructive` será usada pela confirmação humana na Sprint 10.
- **Política padrão:** tools **negadas** até serem liberadas explicitamente (*deny by default*).
- API (`/api/v1/mcp-servers`):
  - CRUD com nova permissão `mcp:manage` (somente admin por padrão; atualize a matriz de RBAC);
  - `POST /:id/test` (conecta, faz o *initialize* e lista as capabilities);
  - `GET /:id/tools` (lista as tools com `inputSchema` e o status da política no projeto);
  - `PUT /:id/policies`.
- **Snapshot das tools:** ao aprovar o servidor, guarde o snapshot de nomes, descrições e `inputSchema`. Se o servidor mudar o schema ou a descrição de uma tool liberada, a chamada é bloqueada até nova revisão do admin (proteção contra *tool poisoning*/*rug pull*). Mostre o diff na UI.

### T2 — Cliente MCP (`packages/mcp-client`)
- Wrapper sobre `@modelcontextprotocol/sdk` com:
  - `connect(server)` e o *handshake* `initialize`;
  - `listTools`, `callTool`, `listResources`, `readResource`, `listPrompts` e `getPrompt`;
  - paginação por `cursor` nas listagens.
- **Transportes:**
  - `streamableHttp` (preferencial) e `sse` (legado), ambos usando o **filtro anti-SSRF** da Sprint 3. Servidores internos exigem a entrada correspondente na allowlist;
  - `stdio`: **somente** para servidores do catálogo com `transport=stdio` aprovados pelo admin, executados em **container efêmero isolado** (imagem definida no catálogo, sem acesso ao host, rede conforme política). Nunca execute o processo stdio diretamente no worker.
- Pool de conexões por `server_id`, reaproveitado entre execuções, com *idle timeout* e reconexão.
- Timeout por chamada (`OLLY_MCP_CALL_TIMEOUT_MS`, padrão 60 000), com cancelamento via `AbortSignal` (notificação `cancelled` do protocolo).
- Limite de tamanho do resultado (`OLLY_MCP_MAX_RESULT_MB`).

### T3 — Autenticação de servidores MCP
- Tipos de credencial:
  - `mcpBearer` (token estático);
  - `mcpHeaders` (headers customizados);
  - `mcpOAuth`: OAuth 2.1 conforme a especificação de autorização do MCP. Inclui *discovery* de metadados do servidor de autorização, Authorization Code + PKCE com *redirect* para `/api/v1/oauth/callback` e *refresh token* armazenado criptografado.
- Fluxo "Conectar" na tela da credencial abre a autorização em uma janela e, ao concluir, mostra o status.

### T4 — Nó `ai.mcpClient`
- **Parâmetros:**
  - `serverId`, filtrado pelos servidores disponíveis no projeto;
  - `operation`: `callTool` | `listTools` | `readResource` | `listResources` | `getPrompt` | `listPrompts`;
  - `toolName` (somente tools permitidas) e `arguments`;
  - `resourceUri`, `promptName` e `promptArguments`.
- **Argumentos da tool:** o formulário é gerado dinamicamente a partir do `inputSchema` da tool, reutilizando o renderizador de JSON Schema da Sprint 1. Cada campo aceita expressão. Há uma alternativa "JSON livre" (expressão que retorna um objeto).
- Validação dos argumentos contra o `inputSchema` (ajv) **antes** da chamada.
- Executa por item, com suporte a `parallelItems`.
- **Saída:**
  - `callTool`: `{ content: [...], structuredContent?, isError }`. Se `isError = true`, aplique `settings.onError`;
  - conteúdo de imagem/áudio/blob vira `binary` (MinIO).

### T5 — Auditoria e log das chamadas
- Tabela `mcp_calls`: `execution_id`, `node_id`, `server_id`, `tool_name`, argumentos **mascarados** (regras da Sprint 8), status, duração, tamanho do resultado e erro.
- Exiba no painel do nó e na tela de execuções.
- Chamada a tool negada pela política: erro `McpToolNotAllowedError` e registro na auditoria com o usuário dono da execução.

### T6 — Frontend
- `/admin/mcp`: catálogo, cadastro, teste de conexão, lista de tools com liberação por projeto, marcação de "destrutiva" e diff de schema pendente de revisão.
- Painel do nó `ai.mcpClient`: seletor de servidor e tool, descrição da tool e formulário dinâmico.

### T7 — Servidor MCP de teste
- Crie em `infra/mcp-test-server/` um servidor MCP simples (TypeScript com o SDK) com:
  - tools `echo`, `soma`, `consulta_cliente` (dados fictícios), `apagar_registro` (marcada como destrutiva nos testes) e `erro` (retorna `isError`);
  - um resource e um prompt.
- Disponível via Streamable HTTP e stdio (imagem Docker), usado nos testes de integração e na demo.
- Adicione um caso que **muda o schema** de uma tool em runtime, para testar o bloqueio por snapshot.

## Fora do escopo

AI Agent, modelos LLM e uso das tools MCP por agentes (Sprint 10).

## Critérios de aceite

| # | Critério | Verificação |
|---|---|---|
| 1 | Workflow chama `soma` com argumentos de expressões via Streamable HTTP e retorna o resultado | Integração |
| 2 | Mesmo resultado via transporte stdio em container isolado | Integração |
| 3 | Tool não liberada na política é recusada com erro claro e registrada na auditoria | Integração |
| 4 | Alteração do schema de uma tool liberada bloqueia a chamada até a revisão do admin | Integração |
| 5 | Argumentos inválidos para o `inputSchema` falham antes da chamada | Unitário |
| 6 | Servidor MCP com URL para IP interno não liberado é bloqueado pelo anti-SSRF | Integração |
| 7 | Fluxo OAuth com servidor de autorização de teste (Keycloak dev) conecta e renova o token | Integração |
| 8 | Toda chamada aparece em `mcp_calls` com argumentos mascarados | Integração |
| 9 | Toda a suíte das sprints anteriores verde | CI |

## Entrega

Código, `infra/mcp-test-server/`, `docs/nos/ai.mcpClient.md`, `docs/mcp-governanca.md` (catálogo, políticas, snapshot, ameaças) e o relatório `docs/relatorios/sprint-09.md`.
