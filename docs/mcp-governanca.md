# Governança MCP

Como o Olly Flow controla o uso de servidores MCP (Model Context Protocol) pelos workflows ([spec 010](../specs/010-cliente-mcp/spec.md)) e, a partir da spec 011, pelos agentes. Nó: [docs/nos/ai.mcpClient.md](nos/ai.mcpClient.md).

**Especificação MCP adotada:** 2025-11-25 (SDK oficial `@modelcontextprotocol/sdk` 1.32, encapsulado em `packages/mcp-client`).

**Transportes:** somente HTTP nesta versão: Streamable HTTP (preferencial) e SSE (legado). O transporte stdio é recusado no cadastro e a plataforma não executa processos de servidores MCP.

## Ameaças consideradas

| Ameaça | Controle |
|---|---|
| Servidor desconhecido ou malicioso | Catálogo: só a administração da plataforma (`mcp:manage`) cadastra e aprova; servidor pendente ou desativado não é usado |
| Ação com efeito real disparada sem intenção | Tools negadas por padrão, liberadas por servidor e projeto; marcação de destrutiva (aprovação humana nos agentes, spec 011) |
| *Tool poisoning* / *rug pull* (descrição ou schema alterados depois da aprovação, ex.: instruções escondidas na descrição) | Snapshot das tools na aprovação; tool liberada que muda fica bloqueada até a revisão do diff |
| SSRF (servidor apontando para a rede interna, metadados da nuvem) | Toda conexão, redirecionamento, descoberta e token OAuth passam pelo filtro anti-SSRF (`OLLY_HTTP_ALLOWLIST` para servidores internos) |
| Vazamento de segredos e dados pessoais | Credenciais cifradas (spec 004/009), nunca devolvidas pela API; argumentos e erros gravados com o mascaramento LGPD do projeto (spec 009) |
| Resultado gigante ou servidor travado | Limite de tamanho (`OLLY_MCP_MAX_RESULT_MB`) aplicado enquanto a resposta chega; timeout por chamada (`OLLY_MCP_CALL_TIMEOUT_MS`) com cancelamento enviado ao servidor |
| Uso sem rastro | Cada operação registrada em `mcp_calls`; negações e bloqueios auditados (`mcp.tool_denied`, `mcp.tool_blocked`); mudanças no catálogo auditadas |

## Catálogo (`/admin/mcp`)

1. **Cadastrar:** nome, transporte, URL, escopo (global ou um projeto) e, se o servidor exigir, uma credencial MCP. O servidor entra **pendente**.
2. **Testar:** conecta (`initialize`) e mostra versão do protocolo, capacidades e tools, sem aprovar.
3. **Aprovar:** conecta, lista as tools e grava o **snapshot** (nome, descrição e `inputSchema`, com hash canônico). O servidor fica **ativo**.
4. **Editar:** trocar URL, transporte, credencial ou escopo volta o servidor a pendente e descarta o snapshot (é outro servidor).
5. **Desativar / excluir:** as conexões abertas são fechadas; execuções passam a falhar com mensagem clara.

Rotas: `GET|POST /mcp-servers`, `GET|PUT|DELETE /mcp-servers/:serverId`, `POST /mcp-servers/:serverId/test|approve|disable`, `GET /mcp-servers/:serverId/tools?projectId=`, `PUT /mcp-servers/:serverId/policies`, `POST /mcp-servers/:serverId/snapshot/accept` (todas `mcp:manage` no escopo da plataforma).

## Políticas de tools

- **Negado por padrão:** sem política, nenhuma tool pode ser chamada.
- **Escopo:** política global (todos os projetos) ou de um projeto; a do projeto prevalece. Ex.: liberar `consulta` para todos e negar no projeto X.
- **Destrutiva:** marcação usada pelos agentes (spec 011) para exigir aprovação humana.
- Só tools do snapshot aprovado podem ser liberadas.
- Para quem monta workflows: `GET /projects/:id/mcp-servers` (`credential:use`) lista os servidores ativos e as tools liberadas, com o schema aprovado (gera o formulário do nó).

## Snapshot e revisão de mudanças

- A cada conexão nova e a cada `notifications/tools/list_changed`, as tools anunciadas são comparadas com o snapshot; a divergência (alterada, nova, removida) fica gravada para revisão.
- Em cada chamada, o hash da tool anunciada pela sessão é comparado com o do snapshot: tool liberada que **mudou ou sumiu** é bloqueada (`mcp.tool_blocked`). Tools **novas** não bloqueiam nada: continuam negadas.
- Na tela, o diff mostra descrição e schema, antes e depois. **Aceitar mudança** atualiza o snapshot e libera as chamadas (auditado como `mcp.snapshot_accept`).

## Autenticação dos servidores

| Credencial | Uso |
|---|---|
| `mcpBearer` | `Authorization: Bearer <token>` |
| `mcpHeaders` | Cabeçalhos `Nome: valor`, um por linha (todos secretos) |
| `mcpOAuth` | OAuth 2.1 conforme a especificação MCP: descoberta (`/.well-known/oauth-protected-resource` → servidor de autorização), registro dinâmico quando não há Client ID, Authorization Code + PKCE (S256), indicador de recurso e renovação automática pelo refresh token |

A credencial do servidor no catálogo vale para teste, aprovação e execuções; a credencial do nó prevalece na execução.

**"Conectar" (OAuth):** na tela de credenciais, abre a autorização num popup. O retorno é `GET /api/v1/oauth/callback` (público; vale pelo `state` de uso único, guardado 10 min no Redis com o verificador PKCE). Os tokens ficam cifrados na credencial e nunca saem da API. Quando o servidor responde 401, o cliente renova o token e grava o novo. O endereço de retorno é `${OLLY_PUBLIC_URL}/api/v1/oauth/callback` e precisa estar registrado no servidor de autorização (no realm de desenvolvimento, o client `olly-mcp`).

## Registro das chamadas

`mcp_calls`: execução, nó, `runIndex`, item, servidor, operação, alvo (tool, URI ou prompt), argumentos mascarados, status (`success`, `error`, `denied`, `blocked`), duração, tamanho do resultado e erro (mascarado). `GET /executions/:id/mcp-calls` (`execution:read`; os argumentos só com `execution:readData`). No editor, "Chamadas MCP" no painel do nó. A retenção segue a dos metadados das execuções (spec 009).

## Servidor de teste

`infra/mcp-test-server` (serviço `mcp-test` do compose, `http://mcp-test:3333/mcp`): tools `echo`, `soma`, `consulta_cliente` (dados fictícios com CPF), `apagar_registro`, `erro` (`isError`), `imagem`, `lento` e `grande`; resource `test://info`; prompt `saudacao`. `MUTATE_SCHEMA=1` muda o schema de `soma` (demonstração do bloqueio). Autenticação opcional por bearer (`MCP_BEARER_TOKEN`) ou OAuth (`MCP_OAUTH_ISSUER`).
