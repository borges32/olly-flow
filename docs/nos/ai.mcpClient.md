# Cliente MCP (`ai.mcpClient`)

Chama tools, lê resources e obtém prompts de servidores MCP (Model Context Protocol) aprovados no catálogo da plataforma. Equivale ao nó "MCP Client" do N8N, com a governança da [spec 010](../../specs/010-cliente-mcp/spec.md): catálogo aprovado, tools negadas por padrão, bloqueio quando uma tool muda e registro de cada chamada. Detalhes da governança: [docs/mcp-governanca.md](../mcp-governanca.md).

| Item | Valor |
|---|---|
| Categoria | IA |
| Entradas | `main` |
| Saídas | `main` (e `error` com `onError: errorOutput`) |
| Credenciais (opcional) | `mcpBearer`, `mcpHeaders`, `mcpOAuth` |
| Itens em paralelo | Sim (`settings.parallelItems`) |
| Especificação MCP | 2025-11-25 (SDK oficial `@modelcontextprotocol/sdk` 1.32) |

## Parâmetros

| Parâmetro | Descrição |
|---|---|
| `serverId` | Servidor do catálogo: só os ativos e disponíveis no projeto (globais ou do próprio projeto) |
| `operation` | `callTool` (padrão), `listTools`, `readResource`, `listResources`, `getPrompt`, `listPrompts` |
| `toolName` | Tool a chamar (`callTool`): só as liberadas para o projeto e sem mudança pendente |
| `argumentsMode` | `form` (padrão: formulário gerado do schema da tool) ou `json` |
| `arguments` | Argumentos no modo formulário. Cada campo aceita valor fixo ou expressão |
| `argumentsJson` | Argumentos no modo JSON: texto JSON ou expressão que produz um objeto |
| `resourceUri` | URI do resource (`readResource`) |
| `promptName`, `promptArguments[]` | Prompt e argumentos `{ name, value }` (`getPrompt`) |

## Saída (um item por item de entrada)

| Operação | `json` |
|---|---|
| `callTool` | `{ content, structuredContent?, isError: false }` (`content` como na especificação MCP) |
| `listTools` | `{ tools: [{ name, description, inputSchema }] }`, só as tools liberadas no projeto |
| `listResources` / `listPrompts` | `{ resources }` / `{ prompts }` |
| `readResource` | `{ uri, contents }` |
| `getPrompt` | `{ description?, messages }` |

## Comportamento

- **Validação antes da chamada (FR-009):** os argumentos são validados contra o `inputSchema` aprovado (snapshot). Argumento inválido falha com `Argumentos inválidos para a tool "<nome>"` e a lista de problemas, sem chegar ao servidor. No modo formulário, valores vindos de expressões são convertidos para o tipo do schema ("3" vira 3) e campos opcionais vazios não são enviados; no modo JSON, os tipos valem como vieram.
- **Governança:** tool não liberada falha com `Tool "<nome>" do servidor MCP "<servidor>" não está liberada para este projeto` (auditado como `mcp.tool_denied`). Tool que mudou desde a aprovação falha até a revisão no catálogo (auditado como `mcp.tool_blocked`). Servidor pendente, desativado ou de outro projeto não é usado.
- **Binários (FR-010):** conteúdo `image`/`audio` (`data`) e resources com `blob` vão para o object storage; o item guarda a referência em `binary.data` (`data_1`, `data_2`...) e, no conteúdo, `binaryProperty` aponta a propriedade.
- **`isError` (FR-010):** a tool que devolve `isError` falha o nó com o texto devolvido, sujeito ao `onError` (`continue` vira item `{ error }`; `errorOutput` desvia o item).
- **Timeout e cancelamento (FR-006):** `OLLY_MCP_CALL_TIMEOUT_MS` (padrão 60 s) por chamada; o cancelamento da execução ou o timeout enviam `notifications/cancelled` ao servidor.
- **Tamanho (FR-006):** resultado acima de `OLLY_MCP_MAX_RESULT_MB` (padrão 10) é recusado enquanto chega.
- **Credencial (FR-007):** a credencial do nó prevalece; sem ela, vale a do servidor no catálogo.
- **Registro (FR-011):** cada operação vai para `mcp_calls` com os argumentos mascarados (regras de LGPD do projeto) e aparece no painel do nó, em "Chamadas MCP".
- **Anti-SSRF:** toda conexão (inclusive a descoberta e o token do OAuth) passa pelo filtro de rede, como no `http.request`.

## Divergências do N8N

- O N8N conecta em qualquer servidor informado no nó; aqui só servidores aprovados no catálogo, com tools liberadas por projeto e bloqueio por mudança (constituição III.7).
- Somente transportes HTTP (Streamable HTTP e SSE legado): o stdio está fora do escopo desta versão.
- "Listar tools" devolve só as tools liberadas para o projeto.

Introduzido na [spec 010](../../specs/010-cliente-mcp/spec.md) (FR-008 a FR-011).
